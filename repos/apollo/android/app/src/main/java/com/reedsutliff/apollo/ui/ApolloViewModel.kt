package com.reedsutliff.apollo.ui

import android.app.Application
import android.content.Context
import android.content.Intent
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.util.Log
import androidx.core.content.FileProvider
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.reedsutliff.apollo.ApolloApplication
import com.reedsutliff.apollo.LogBuffer
import com.reedsutliff.apollo.data.AppDatabase
import com.reedsutliff.apollo.data.entities.MessageEntity
import com.reedsutliff.apollo.data.entities.ThreadEntity
import com.reedsutliff.apollo.data.preferences.ApolloPreferences
import com.reedsutliff.apollo.data.repository.SettingsRepository
import com.reedsutliff.apollo.data.repository.ThreadRepository
import com.reedsutliff.apollo.model.AppSettings
import com.reedsutliff.apollo.model.ChatMessage
import com.reedsutliff.apollo.model.ConnectionState
import com.reedsutliff.apollo.model.MessageModality
import com.reedsutliff.apollo.model.MessageStatus
import com.reedsutliff.apollo.model.PttButtonState
import com.reedsutliff.apollo.model.Thread
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject
import java.io.IOException
import java.io.PipedInputStream
import java.io.PipedOutputStream
import java.util.UUID
import java.util.concurrent.TimeUnit

// ── Constants ─────────────────────────────────────────────────

private const val LOG_TAG = "ApolloVM"
private const val SAMPLE_RATE = 16000
private const val AUDIO_BUFFER_SIZE = 4096
private const val MAX_RECONNECT_DELAY_MS = 30_000L
private const val BASE_RECONNECT_DELAY_MS = 1_000L

// ── Input mode ────────────────────────────────────────────────

enum class InputMode { TEXT, VOICE }

// ── ViewModel ─────────────────────────────────────────────────

class ApolloViewModel(application: Application) : AndroidViewModel(application) {

    // ── StateFlows ──────────────────────────────────────────

    private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    private val _pttState = MutableStateFlow(PttButtonState.IDLE)
    val pttState: StateFlow<PttButtonState> = _pttState.asStateFlow()

    private val _threadList = MutableStateFlow<List<Thread>>(emptyList())
    val threadList: StateFlow<List<Thread>> = _threadList.asStateFlow()

    private val _currentThread = MutableStateFlow<Thread?>(null)
    val currentThread: StateFlow<Thread?> = _currentThread.asStateFlow()

    private val _messages = MutableStateFlow<List<ChatMessage>>(emptyList())
    val messages: StateFlow<List<ChatMessage>> = _messages.asStateFlow()

    private val _settings = MutableStateFlow(AppSettings())
    val settings: StateFlow<AppSettings> = _settings.asStateFlow()

    private val _inputMode = MutableStateFlow(InputMode.VOICE)
    val inputMode: StateFlow<InputMode> = _inputMode.asStateFlow()

    private val _transcript = MutableStateFlow("")
    val transcript: StateFlow<String> = _transcript.asStateFlow()

    // ── Internal ────────────────────────────────────────────

    private var wsClient: ApolloWebSocketClient? = null
    private var sessionId: String? = null
    private val appContext get() = getApplication<Application>()

    // ── Data layer ──────────────────────────────────────────

    private val db = AppDatabase.getInstance(appContext)
    private val threadDao = db.threadDao()
    private val messageDao = db.messageDao()
    private val threadRepository = ThreadRepository(threadDao, messageDao)
    private val settingsRepository = SettingsRepository(ApolloPreferences(appContext))
    private var messagesJob: Job? = null

    // ── Offline message queue ──────────────────────────────────
    private data class PendingMessage(
        val id: String,
        val threadId: String,
        val text: String,
        val sessionId: String,
    )
    private val pendingMessages = mutableListOf<PendingMessage>()

    init {
        // Load persisted settings from DataStore
        viewModelScope.launch {
            settingsRepository.settings.collect { _settings.value = it }
        }

        // Load persisted threads from Room
        viewModelScope.launch {
            threadRepository.allThreads.collect { entities ->
                _threadList.value = entities.map { it.toModel() }
            }
        }

        // Create a default thread if none exist
        if (_threadList.value.isEmpty()) {
            createDefaultThread()
        }

        // Select last active thread or first one
        val lastId = _settings.value.lastThreadId
        val thread = if (lastId != null) {
            _threadList.value.find { it.id == lastId }
        } else {
            _threadList.value.firstOrNull()
        }
        if (thread != null) {
            _currentThread.value = thread
            // Load messages from Room
            loadMessagesForThread(thread.id)
        }
    }

    // ── Public API ──────────────────────────────────────────

    fun connect() {
        Log.i(LOG_TAG, "connect()")
        val s = _settings.value
        wsClient?.disconnect()
        wsClient = ApolloWebSocketClient(
            wsUrl = s.serverUrl,
            cfClientId = s.cfClientId,
            cfClientSecret = s.cfClientSecret,
        ).also { it.connect() }
    }

    fun disconnect() {
        Log.i(LOG_TAG, "disconnect()")
        wsClient?.disconnect()
        wsClient = null
        _connectionState.value = ConnectionState.DISCONNECTED
    }

    fun sendText(text: String) {
        if (text.isBlank()) return
        val thread = _currentThread.value ?: run {
            val t = createDefaultThread()
            t
        }

        val messageId = UUID.randomUUID().toString()
        val isConnected = _connectionState.value == ConnectionState.CONNECTED

        val message = ChatMessage(
            id = messageId,
            threadId = thread.id,
            text = text.trim(),
            isUser = true,
            modality = MessageModality.TEXT,
            status = if (isConnected) MessageStatus.SENDING else MessageStatus.QUEUED,
        )

        // Add message to local list immediately (instant UI update)
        _messages.value = _messages.value + message

        // Update thread preview
        val updatedThread = thread.copy(
            lastMessagePreview = text.trim().take(100),
            lastMessageTimestamp = System.currentTimeMillis(),
        )
        _threadList.value = _threadList.value.map {
            if (it.id == thread.id) updatedThread else it
        }

        // Persist to Room in one sequential block (thread first, then message)
        viewModelScope.launch {
            threadDao.insert(updatedThread.toEntity())
            messageDao.insert(message.toEntity())
        }

        if (isConnected) {
            // Send via WebSocket immediately with client_message_id for tracking
            wsClient?.sendMessage(
                JSONObject().apply {
                    put("type", "text_input")
                    put("thread_id", thread.id)
                    put("session_id", sessionId ?: "")
                    put("text", text.trim())
                    put("client_message_id", messageId)
                }.toString()
            )
            Log.i(LOG_TAG, "sendText: ${text.take(50)}...")
        } else {
            // Queue for later delivery when connection resumes
            pendingMessages.add(PendingMessage(messageId, thread.id, text.trim(), sessionId ?: ""))
            Log.i(LOG_TAG, "sendText: queued (offline) — ${text.take(50)}...")
        }
    }

    fun startPtt() {
        Log.i(LOG_TAG, "startPtt() — conn=${_connectionState.value}")
        if (_connectionState.value != ConnectionState.CONNECTED) {
            Log.w(LOG_TAG, "PTT pressed but not connected — reconnecting")
            connect()
            return
        }

        // Barge-in: interrupt if processing or playing
        if (_pttState.value == PttButtonState.PROCESSING ||
            _pttState.value == PttButtonState.PLAYING) {
            interrupt()
        }

        wsClient?.startRecording()
    }

    fun stopPtt() {
        if (_pttState.value == PttButtonState.RECORDING) {
            Log.i(LOG_TAG, "stopPtt()")
            wsClient?.stopRecording()
        }
    }

    fun interrupt() {
        Log.i(LOG_TAG, "interrupt()")
        wsClient?.interrupt()
    }

    fun switchThread(threadId: String) {
        Log.i(LOG_TAG, "switchThread($threadId)")
        val thread = _threadList.value.find { it.id == threadId } ?: return
        _currentThread.value = thread
        sessionId = thread.sessionId

        // Update lastThreadId in settings
        updateSettings(_settings.value.copy(lastThreadId = threadId))

        // Send session switch to server if connected
        wsClient?.sendMessage(JSONObject().apply {
            put("type", "switch_session")
            put("session_id", sessionId ?: "")
        }.toString())

        loadMessagesForThread(threadId)
    }

    fun createThread(name: String): Thread {
        val thread = Thread(
            id = UUID.randomUUID().toString(),
            name = name.trim().ifBlank { "Thread ${_threadList.value.size + 1}" },
        )
        _threadList.value = _threadList.value + thread

        // Persist to Room
        viewModelScope.launch {
            threadDao.insert(thread.toEntity())
        }

        Log.i(LOG_TAG, "createThread: ${thread.name} (${thread.id})")

        // Auto-switch to new thread
        switchThread(thread.id)
        return thread
    }

    fun deleteThread(threadId: String) {
        val thread = _threadList.value.find { it.id == threadId } ?: return
        Log.i(LOG_TAG, "deleteThread: ${thread.name}")

        // Soft-delete: mark archived
        _threadList.value = _threadList.value.map {
            if (it.id == threadId) it.copy(isArchived = true) else it
        }

        // Persist delete to Room
        viewModelScope.launch {
            messageDao.deleteByThreadId(threadId)
            threadDao.delete(thread.toEntity())
        }

        // If deleting the current thread, switch to another
        if (_currentThread.value?.id == threadId) {
            val next = _threadList.value.firstOrNull { !it.isArchived }
            if (next != null) {
                switchThread(next.id)
            } else {
                _currentThread.value = null
                _messages.value = emptyList()
            }
        }
    }

    fun updateSettings(newSettings: AppSettings) {
        _settings.value = newSettings

        // Persist to DataStore
        viewModelScope.launch {
            settingsRepository.update(newSettings)
        }

        Log.i(LOG_TAG, "updateSettings: serverUrl=${newSettings.serverUrl}")
    }

    fun setInputMode(mode: InputMode) {
        _inputMode.value = mode
    }

    /**
     * Generates a combined log report (recent in-memory logs + crash files)
     * and launches the system share sheet. The report is written to a temp
     * file in cacheDir and shared via FileProvider content URI.
     *
     * @param context Any context (typically the Activity) used to start the intent.
     */
    fun shareLogs(context: Context) {
        Log.i(LOG_TAG, "Share logs requested")
        val app = getApplication<ApolloApplication>()
        app.shareLogs(context)
    }

    // ── Internal helpers ────────────────────────────────────

    private fun createDefaultThread(): Thread {
        val thread = Thread(name = "General")
        _threadList.value = listOf(thread)
        _currentThread.value = thread
        return thread
    }

    private fun loadMessagesForThread(threadId: String) {
        messagesJob?.cancel()
        messagesJob = viewModelScope.launch {
            threadRepository.getMessages(threadId).collect { entities ->
                _messages.value = entities.map { it.toModel() }
            }
        }
        Log.i(LOG_TAG, "loadMessagesForThread($threadId)")
    }

    override fun onCleared() {
        super.onCleared()
        messagesJob?.cancel()
        wsClient?.disconnect()
        wsClient = null
        Log.i(LOG_TAG, "ViewModel cleared")
    }

    // ── Inner: ApolloWebSocketClient ─────────────────────────

    /**
     * WebSocket + Audio client, owned by the ViewModel.
     * Mirrors the PTTWebSocketClient from v1 but routes state changes
     * through ViewModel StateFlows instead of lambdas.
     */
    private inner class ApolloWebSocketClient(
        private val wsUrl: String,
        private val cfClientId: String,
        private val cfClientSecret: String,
    ) {
        private val client = OkHttpClient.Builder()
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .pingInterval(30, TimeUnit.SECONDS)
            .build()

        private var ws: WebSocket? = null
        private var audioRecord: AudioRecord? = null
        private var recordingJob: Job? = null
        private var scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
        private var exoPlayer: androidx.media3.exoplayer.ExoPlayer? = null
        private var pipedOut: PipedOutputStream? = null
        private var isPlaying = false

        // Async replay state
        private var lastSeq: Int = 0
        private var reconnectAttempt: Int = 0
        private var reconnectJob: Job? = null
        private val replayAudioBuffer = ArrayDeque<ByteArray>()

        private fun log(level: String, msg: String) {
            // Route through centralized in-memory ring buffer for crash log sharing
            Log.d("ApolloWS", "[$level] $msg")
            LogBuffer.log(level, "ApolloWS", msg)
        }

        fun connect() {
            log("I", "connect() — url=$wsUrl")
            _connectionState.value = ConnectionState.CONNECTING

            val request = Request.Builder()
                .url(wsUrl)
                .apply {
                    if (cfClientId.isNotBlank()) addHeader("CF-Access-Client-Id", cfClientId)
                    if (cfClientSecret.isNotBlank()) addHeader("CF-Access-Client-Secret", cfClientSecret)
                }
                .build()

            ws = client.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(ws: WebSocket, response: Response) {
                    log("I", "WebSocket OPEN — code=${response.code}")
                    _connectionState.value = ConnectionState.CONNECTED
                    reconnectAttempt = 0

                    val handshake = JSONObject().apply {
                        put("type", "reconnect")
                        put("session_id", sessionId ?: "")
                        put("last_seq", lastSeq)
                        put("thread_id", _currentThread.value?.id ?: "")
                    }
                    val msg = handshake.toString()
                    log("I", "Sending handshake: $msg")
                    ws.send(msg)
                    
                    // Flush any queued messages from offline period
                    flushPendingMessages()
                }

                override fun onMessage(ws: WebSocket, text: String) {
                    log("D", "TEXT ← ${text.take(200)}")
                    handleText(text)
                }

                override fun onMessage(ws: WebSocket, bytes: ByteString) {
                    log("D", "BINARY ← ${bytes.size} bytes")
                    handleBinary(bytes.toByteArray())
                }

                override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                    log("E", "WebSocket FAILURE — ${t.message}")
                    _connectionState.value = ConnectionState.DISCONNECTED
                    _pttState.value = PttButtonState.IDLE
                    stopPlayback()
                    scheduleReconnect()
                }

                override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                    log("I", "WebSocket CLOSED — code=$code reason=$reason")
                    _connectionState.value = ConnectionState.DISCONNECTED
                    _pttState.value = PttButtonState.IDLE
                    scheduleReconnect()
                }
            })
        }

        fun disconnect() {
            log("I", "disconnect()")
            stopRecording()
            stopPlayback()
            reconnectJob?.cancel()
            reconnectJob = null
            ws?.close(1000, "User disconnect")
            ws = null
            scope.cancel()
        }

        // ── Send raw message ─────────────────────────────────

        fun sendMessage(text: String) {
            log("D", "SEND → ${text.take(200)}")
            ws?.send(text)
        }

        // ── Flush offline queue ────────────────────────────────

        private fun flushPendingMessages() {
            // Flush in-memory pending queue
            val toFlush = pendingMessages.toList()
            pendingMessages.clear()

            // Also check for QUEUED messages loaded from Room (app restart case)
            val roomQueued = _messages.value.filter { it.status == MessageStatus.QUEUED }
            val allQueued = toFlush + roomQueued.map {
                PendingMessage(it.id, it.threadId, it.text, sessionId ?: "")
            }

            if (allQueued.isEmpty()) return
            log("I", "Flushing ${allQueued.size} queued messages")

            for (pm in allQueued.distinctBy { it.id }) {
                val payload = JSONObject().apply {
                    put("type", "text_input")
                    put("thread_id", pm.threadId)
                    put("session_id", pm.sessionId)
                    put("text", pm.text)
                    put("client_message_id", pm.id)
                }
                log("D", "SEND → ${payload.toString().take(200)}")
                ws?.send(payload.toString())

                // Update status QUEUED → SENDING in local state
                val current = _messages.value.find { it.id == pm.id } ?: continue
                _messages.value = _messages.value.map {
                    if (it.id == pm.id) it.copy(status = MessageStatus.SENDING) else it
                }
                // Persist status change
                viewModelScope.launch {
                    messageDao.insert(current.copy(status = MessageStatus.SENDING).toEntity())
                }
            }
        }

        // ── Auto-reconnect ───────────────────────────────────

        private fun scheduleReconnect() {
            reconnectJob?.cancel()
            val delay = minOf(
                BASE_RECONNECT_DELAY_MS * (1L shl reconnectAttempt.coerceAtMost(5)),
                MAX_RECONNECT_DELAY_MS,
            )
            reconnectAttempt++
            log("I", "scheduleReconnect() — attempt=$reconnectAttempt delay=${delay}ms")
            reconnectJob = scope.launch {
                delay(delay)
                connect()
            }
        }

        // ── Seq ack tick ────────────────────────────────────

        private var ackJob: Job? = null

        private fun startAckTicker() {
            log("D", "startAckTicker()")
            ackJob?.cancel()
            ackJob = scope.launch {
                while (isActive) {
                    delay(5_000)
                    sendAck()
                }
            }
        }

        private fun stopAckTicker() {
            ackJob?.cancel()
            ackJob = null
        }

        private fun sendAck() {
            val ack = JSONObject().apply {
                put("type", "ack")
                put("seq", lastSeq)
            }
            log("D", "ACK → seq=$lastSeq")
            ws?.send(ack.toString())
        }

        // ── Barge-in ────────────────────────────────────────

        fun interrupt() {
            log("I", "interrupt() — session=$sessionId")
            stopPlayback()
            ws?.send(JSONObject().apply { put("type", "interrupt") }.toString())
            _pttState.value = PttButtonState.INTERRUPTED
        }

        // ── Recording ───────────────────────────────────────

        fun startRecording() {
            log("I", "startRecording()")
            if (audioRecord != null) {
                log("W", "Already recording, returning")
                return
            }

            val bufferSize = maxOf(
                AudioRecord.getMinBufferSize(
                    SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT
                ),
                AUDIO_BUFFER_SIZE * 4,
            )
            log("I", "AudioRecord bufferSize=$bufferSize")

            try {
                audioRecord = AudioRecord(
                    MediaRecorder.AudioSource.MIC,
                    SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    bufferSize,
                ).apply {
                    startRecording()
                }

                _pttState.value = PttButtonState.RECORDING

                recordingJob = scope.launch {
                    val buf = ByteArray(AUDIO_BUFFER_SIZE)
                    var totalBytes = 0
                    var frames = 0
                    while (isActive && audioRecord?.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
                        val bytesRead = audioRecord?.read(buf, 0, AUDIO_BUFFER_SIZE) ?: -1
                        if (bytesRead > 0) {
                            val ob = okio.Buffer()
                            ob.write(buf, 0, bytesRead)
                            ws?.send(ob.readByteString())
                            totalBytes += bytesRead
                            frames++
                        } else if (bytesRead < 0) {
                            log("W", "AudioRecord.read returned $bytesRead")
                        }
                    }
                    log("I", "Recording loop ended: $frames frames, $totalBytes bytes")
                }
            } catch (e: Exception) {
                log("E", "startRecording failed: ${e.message}")
                _pttState.value = PttButtonState.IDLE
                audioRecord?.release()
                audioRecord = null
            }
        }

        fun stopRecording() {
            log("I", "stopRecording()")
            recordingJob?.cancel()
            recordingJob = null
            try { audioRecord?.stop() } catch (_: Exception) {}
            audioRecord?.release()
            audioRecord = null

            ws?.send(JSONObject().apply { put("type", "ptt_end") }.toString())
            _pttState.value = PttButtonState.PROCESSING
        }

        // ── Text message handling ───────────────────────────

        private fun handleText(text: String) {
            try {
                val json = JSONObject(text)
                val type = json.optString("type", "?")

                // Track sequence number
                val seq = json.optInt("seq", 0)
                if (seq > lastSeq) lastSeq = seq

                when (type) {
                    "reconnect_done" -> {
                        val replayed = json.optBoolean("replayed", false)
                        log("I", "reconnect_done — replayed=$replayed")
                        startAckTicker()
                    }
                    "stt_transcript" -> {
                        val t = json.optString("text", "")
                        log("I", "STT transcript (${t.length} chars)")
                        addMessage(ChatMessage(
                            id = UUID.randomUUID().toString(),
                            threadId = _currentThread.value?.id ?: "",
                            text = t,
                            isUser = true,
                            modality = MessageModality.VOICE,
                            status = MessageStatus.SENT,
                        ))
                        _transcript.value = t
                    }
                    "tts_start" -> {
                        val t = json.optString("text", "")
                        log("I", "TTS start (${t.length} chars)")
                        _pttState.value = PttButtonState.PLAYING
                        addMessage(ChatMessage(
                            id = UUID.randomUUID().toString(),
                            threadId = _currentThread.value?.id ?: "",
                            text = t,
                            isUser = false,
                            modality = MessageModality.VOICE,
                            status = MessageStatus.DELIVERED,
                        ))
                        drainReplayBuffer()
                    }
                    "tts_end" -> {
                        log("I", "TTS end")
                        stopPlayback()
                        replayAudioBuffer.clear()
                        _pttState.value = PttButtonState.IDLE
                    }
                    "tts_fallback" -> {
                        val t = json.optString("text", "") + " 🔇"
                        log("I", "TTS fallback")
                        _pttState.value = PttButtonState.IDLE

                        // Mark last user SENT message as DELIVERED (Hermes processed it)
                        _messages.value = _messages.value.map {
                            if (it.isUser && it.status == MessageStatus.SENT) it.copy(status = MessageStatus.DELIVERED) else it
                        }
                        // Persist status changes
                        val userMsg = _messages.value.find { it.isUser && it.status == MessageStatus.DELIVERED }
                        if (userMsg != null) {
                            viewModelScope.launch {
                                messageDao.insert(userMsg.toEntity())
                            }
                        }

                        addMessage(ChatMessage(
                            id = UUID.randomUUID().toString(),
                            threadId = _currentThread.value?.id ?: "",
                            text = t,
                            isUser = false,
                            modality = MessageModality.VOICE,
                            status = MessageStatus.DELIVERED,
                        ))
                        replayAudioBuffer.clear()
                    }
                    "processing" -> {
                        val step = json.optString("step", "")
                        log("D", "processing step=$step")
                    }
                    "session_id" -> {
                        sessionId = json.optString("id", "")
                        log("I", "session_id received: $sessionId")

                        // Update current thread's session ID
                        _currentThread.value?.let { thread ->
                            val updated = thread.copy(sessionId = sessionId)
                            _currentThread.value = updated
                            _threadList.value = _threadList.value.map {
                                if (it.id == thread.id) updated else it
                            }
                            // Persist session ID to Room
                            viewModelScope.launch {
                                threadDao.update(updated.toEntity())
                            }
                        }
                    }
                    "interrupted" -> {
                        log("I", "Server confirmed interrupt")
                        stopPlayback()
                        replayAudioBuffer.clear()
                        _pttState.value = PttButtonState.IDLE
                    }
                    "error" -> {
                        val msg = json.optString("message", "Unknown error")
                        log("E", "Server error: $msg")
                        _pttState.value = PttButtonState.IDLE
                    }
                    "text_echo" -> {
                        // Server echoes user text — update status to SENT
                        val echoText = json.optString("text", "")
                        val clientMsgId = json.optString("client_message_id", null)
                        log("D", "text_echo: client_message_id=$clientMsgId")

                        if (clientMsgId != null) {
                            // Mark the matching message as SENT (server confirmed receipt)
                            _messages.value = _messages.value.map {
                                if (it.id == clientMsgId) it.copy(status = MessageStatus.SENT) else it
                            }
                            // Persist status update to Room
                            val updatedMsg = _messages.value.find { it.id == clientMsgId }
                            if (updatedMsg != null) {
                                viewModelScope.launch {
                                    messageDao.insert(updatedMsg.toEntity())
                                }
                            }
                        }
                    }
                    "ping" -> { /* keepalive */ }
                    "pong" -> { /* keepalive response */ }
                    else -> {
                        log("W", "Unknown message type: $type")
                    }
                }
            } catch (e: Exception) {
                log("E", "handleText parse error: ${e.message}")
            }
        }

        // ── Audio playback ─────────────────────────────────

        @androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
        private fun startPlayback() {
            log("I", "startPlayback()")
            if (isPlaying) return
            isPlaying = true

            try {
                val pipedIn = PipedInputStream()
                pipedOut = PipedOutputStream(pipedIn)

                val ds = object : androidx.media3.datasource.DataSource {
                    private var position = 0L
                    override fun open(dataSpec: androidx.media3.datasource.DataSpec): Long {
                        position = 0
                        return Long.MAX_VALUE
                    }
                    override fun read(buffer: ByteArray, offset: Int, count: Int): Int {
                        return pipedIn.read(buffer, offset, count)
                    }
                    override fun getUri() = null
                    override fun close() {}
                    override fun addTransferListener(listener: androidx.media3.datasource.TransferListener) {}
                }

                exoPlayer = androidx.media3.exoplayer.ExoPlayer.Builder(appContext).build().apply {
                    val mi = androidx.media3.common.MediaItem.Builder()
                        .setMimeType(androidx.media3.common.MimeTypes.AUDIO_OGG)
                        .build()
                    setMediaSource(
                        androidx.media3.exoplayer.source.ProgressiveMediaSource
                            .Factory { ds }
                            .createMediaSource(mi)
                    )
                    prepare()
                    playWhenReady = true
                    log("I", "ExoPlayer prepared")
                }
            } catch (e: Exception) {
                log("E", "startPlayback failed: ${e.message}")
                isPlaying = false
                exoPlayer = null
                pipedOut = null
            }
        }

        private fun handleBinary(data: ByteArray) {
            if (isPlaying && pipedOut != null) {
                try {
                    pipedOut?.write(data)
                    pipedOut?.flush()
                } catch (e: IOException) {
                    log("W", "handleBinary: pipe write error — ${e.message}")
                }
            } else {
                log("D", "handleBinary: buffering ${data.size} bytes")
                replayAudioBuffer.addLast(data)
            }
        }

        private fun stopPlayback() {
            log("I", "stopPlayback()")
            isPlaying = false
            try {
                exoPlayer?.stop()
                exoPlayer?.release()
            } catch (_: Exception) {}
            exoPlayer = null
            try { pipedOut?.close() } catch (_: IOException) {}
            pipedOut = null
        }

        private fun drainReplayBuffer() {
            if (replayAudioBuffer.isNotEmpty()) {
                log("I", "draining ${replayAudioBuffer.size} buffered chunks")
                startPlayback()
                while (replayAudioBuffer.isNotEmpty()) {
                    val chunk = replayAudioBuffer.removeFirst()
                    try {
                        pipedOut?.write(chunk)
                        pipedOut?.flush()
                    } catch (_: IOException) {}
                }
            } else {
                startPlayback()
            }
        }
    }

    // ── Private helpers ─────────────────────────────────────

    private fun addMessage(message: ChatMessage) {
        _messages.value = _messages.value + message

        // Persist message to Room
        viewModelScope.launch {
            messageDao.insert(message.toEntity())
        }

        // Update thread preview
        _currentThread.value?.let { thread ->
            val updated = thread.copy(
                lastMessagePreview = message.text.take(100),
                lastMessageTimestamp = message.timestamp,
            )
            _threadList.value = _threadList.value.map {
                if (it.id == thread.id) updated else it
            }

            // Persist thread update to Room
            viewModelScope.launch {
                threadDao.update(updated.toEntity())
            }
        }
    }
}

// ── Model ↔ Entity mappings ────────────────────────────────────

fun Thread.toEntity(): ThreadEntity = ThreadEntity(
    id = id,
    name = name,
    sessionId = sessionId,
    lastMessagePreview = lastMessagePreview,
    lastMessageTimestamp = lastMessageTimestamp,
    createdAt = createdAt,
    isArchived = isArchived,
)

fun ThreadEntity.toModel(): Thread = Thread(
    id = id,
    name = name,
    sessionId = sessionId,
    lastMessagePreview = lastMessagePreview,
    lastMessageTimestamp = lastMessageTimestamp,
    createdAt = createdAt,
    isArchived = isArchived,
)

fun ChatMessage.toEntity(): MessageEntity = MessageEntity(
    id = id,
    threadId = threadId,
    text = text,
    isUser = isUser,
    modality = modality.name,
    status = status.name,
    timestamp = timestamp,
    interrupted = interrupted,
    runId = runId,
)

fun MessageEntity.toModel(): ChatMessage = ChatMessage(
    id = id,
    threadId = threadId,
    text = text,
    isUser = isUser,
    modality = try { MessageModality.valueOf(modality) } catch (_: Exception) { MessageModality.TEXT },
    status = try { MessageStatus.valueOf(status) } catch (_: Exception) { MessageStatus.SENT },
    timestamp = timestamp,
    interrupted = interrupted,
    runId = runId,
)
