package com.reedsutliff.apollo

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.EaseInOutCubic
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.*
import okio.*
import org.json.JSONObject
import java.io.File
import java.io.FileWriter
import java.io.IOException
import java.io.PipedInputStream
import java.io.PipedOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

// ── Hardcoded config (single consumer) ────────────────────────

private const val WS_URL = "wss://apollo.ffilt.us/v1/ptt"
private const val CF_CLIENT_ID = "d2845237d9ac395bde2d9b946431742c.access"
private const val CF_CLIENT_SECRET = "6aa475541cbe9c694b23cff57627da320f184975247fac2910307c519087ab86"
private const val SAMPLE_RATE = 16000
private const val AUDIO_BUFFER_SIZE = 4096
private const val MAX_RECONNECT_DELAY_MS = 30_000L
private const val BASE_RECONNECT_DELAY_MS = 1_000L
private const val LOG_TAG = "Apollo"

// ── In-app file logger ───────────────────────────────────────
// Writes to both logcat and a rolling in-memory buffer that gets
// flushed to a file on error.  Share the file to debug crashes.

object ApolloLogger {
    private const val MAX_LINES = 2000
    private val buffer = ArrayDeque<String>()
    private val lock = Any()

    fun d(msg: String) = log('D', msg)
    fun i(msg: String) = log('I', msg)
    fun w(msg: String) = log('W', msg)
    fun e(msg: String) = log('E', msg)
    fun e(msg: String, thr: Throwable?) {
        log('E', "$msg — ${thr?.message ?: ""}")
        thr?.let { Log.e(LOG_TAG, msg, it) }
    }

    private fun log(level: Char, msg: String) {
        val ts = SimpleDateFormat("HH:mm:ss.SSS", Locale.US).format(Date())
        val line = "$ts [$level] $msg"
        // Always write to logcat
        when (level) {
            'D' -> Log.d(LOG_TAG, msg)
            'I' -> Log.i(LOG_TAG, msg)
            'W' -> Log.w(LOG_TAG, msg)
            'E' -> Log.e(LOG_TAG, msg)
        }
        // Buffer for file export
        synchronized(lock) {
            buffer.addLast(line)
            if (buffer.size > MAX_LINES) buffer.removeFirst()
        }
    }

    /** Dump the in-memory buffer to a file in the app's cache dir. */
    fun dumpToFile(appContext: android.content.Context): File? {
        val file = File(appContext.cacheDir, "apollo-log-${System.currentTimeMillis()}.txt")
        try {
            FileWriter(file).use { fw ->
                synchronized(lock) {
                    for (line in buffer) {
                        fw.write(line)
                        fw.write('\n'.code)
                    }
                }
            }
            Log.i(LOG_TAG, "Log dumped to ${file.absolutePath}")
            return file
        } catch (e: Exception) {
            Log.e(LOG_TAG, "Failed to dump log", e)
            return null
        }
    }
}

// ── Data models ──────────────────────────────────────────────

data class ChatMessage(
    val text: String,
    val isUser: Boolean,
    val timestamp: String,
    val interrupted: Boolean = false,
)

enum class ConnectionState { DISCONNECTED, CONNECTING, CONNECTED }

enum class PttButtonState { IDLE, RECORDING, PROCESSING, PLAYING, INTERRUPTED }

// ── Main Activity ────────────────────────────────────────────

class MainActivity : ComponentActivity() {
    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        ApolloLogger.i("Microphone permission result: granted=$granted")
        if (!granted) {
            Toast.makeText(this, "Microphone permission required", Toast.LENGTH_LONG).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ApolloLogger.i("=== Apollo starting (v1.0.0) ===")

        // Global crash handler — writes crash to log + file before dying
        Thread.setDefaultUncaughtExceptionHandler { thread, ex ->
            ApolloLogger.e("CRASH on thread ${thread.name}", ex)
            ApolloLogger.dumpToFile(this)
            // Re-throw so the OS shows the crash dialog
            if (thread == Looper.getMainLooper().thread) {
                throw RuntimeException(ex)
            }
        }

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED) {
            ApolloLogger.i("Requesting microphone permission")
            permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        } else {
            ApolloLogger.i("Microphone permission already granted")
        }

        setContent {
            ApolloTheme {
                ApolloApp(context = this)
            }
        }
    }

    override fun onDestroy() {
        ApolloLogger.i("Activity destroyed")
        super.onDestroy()
    }
}

// ── Composable App ───────────────────────────────────────────

@Composable
fun ApolloApp(context: ComponentActivity) {
    var connectionState by remember { mutableStateOf(ConnectionState.DISCONNECTED) }
    var pttState by remember { mutableStateOf(PttButtonState.IDLE) }
    var transcript by remember { mutableStateOf(listOf<ChatMessage>()) }
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()

    // WebSocket client — single instance across recompositions
    val wsClient = remember {
        PTTWebSocketClient(
            appContext = context,
            wsUrl = WS_URL,
            cfClientId = CF_CLIENT_ID,
            cfClientSecret = CF_CLIENT_SECRET,
            onStateChange = { connectionState = it },
            onPttStateChange = { pttState = it },
            onTranscript = { msg ->
                transcript = transcript + msg
                scope.launch {
                    listState.animateScrollToItem(transcript.size - 1)
                }
            },
            onError = { msg ->
                Handler(Looper.getMainLooper()).post {
                    Toast.makeText(context, msg, Toast.LENGTH_SHORT).show()
                }
            },
        )
    }

    // Auto-connect
    LaunchedEffect(Unit) {
        ApolloLogger.i("Auto-connect triggered")
        wsClient.connect()
    }

    // Cleanup on dispose
    androidx.compose.runtime.DisposableEffect(Unit) {
        onDispose { wsClient.disconnect() }
    }

    fun onPttDown() {
        ApolloLogger.i("PTT down, conn=$connectionState ptt=$pttState")
        if (connectionState != ConnectionState.CONNECTED) {
            ApolloLogger.w("PTT pressed but not connected — reconnecting")
            wsClient.connect()
            return
        }
        val vibrator = context.getSystemService(android.content.Context.VIBRATOR_SERVICE) as Vibrator
        vibrator.vibrate(VibrationEffect.createOneShot(30, VibrationEffect.DEFAULT_AMPLITUDE))

        // Barge-in: interrupt if processing or playing
        if (pttState == PttButtonState.PROCESSING || pttState == PttButtonState.PLAYING) {
            ApolloLogger.i("Barge-in: interrupting $pttState")
            wsClient.interrupt()
        }

        wsClient.startRecording()
    }

    fun onPttUp() {
        if (pttState == PttButtonState.RECORDING) {
            ApolloLogger.i("PTT up — stopping recording")
            val vibrator = context.getSystemService(android.content.Context.VIBRATOR_SERVICE) as Vibrator
            vibrator.vibrate(VibrationEffect.createOneShot(30, VibrationEffect.DEFAULT_AMPLITUDE))
            wsClient.stopRecording()
        }
    }

    Scaffold { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
        ) {
            // Status bar
            StatusBar(connectionState, pttState)
            Spacer(Modifier.height(8.dp))

            // Chat transcript
            ChatTranscript(
                messages = transcript,
                listState = listState,
                modifier = Modifier.weight(1f),
            )

            Spacer(Modifier.height(16.dp))

            // PTT button
            PTTButton(
                state = pttState,
                onDown = ::onPttDown,
                onUp = ::onPttUp,
            )
        }
    }
}

// ── Status Bar ───────────────────────────────────────────────

@Composable
fun StatusBar(conn: ConnectionState, ptt: PttButtonState) {
    val dotColor = when (conn) {
        ConnectionState.CONNECTED -> Color(0xFF22C55E)
        ConnectionState.CONNECTING -> Color(0xFFEAB308)
        ConnectionState.DISCONNECTED -> Color(0xFFEF4444)
    }

    val statusText = when {
        ptt == PttButtonState.RECORDING -> "Recording…"
        ptt == PttButtonState.PROCESSING -> "Processing…"
        ptt == PttButtonState.PLAYING -> "Playing…"
        conn == ConnectionState.CONNECTED -> "Connected"
        conn == ConnectionState.CONNECTING -> "Connecting…"
        else -> "Disconnected"
    }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
    ) {
        Box(
            modifier = Modifier
                .size(12.dp)
                .clip(CircleShape)
                .background(dotColor),
        )
        Spacer(Modifier.width(8.dp))
        Text(statusText, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// ── Chat Transcript ──────────────────────────────────────────

@Composable
fun ChatTranscript(
    messages: List<ChatMessage>,
    listState: androidx.compose.foundation.lazy.LazyListState,
    modifier: Modifier = Modifier,
) {
    LazyColumn(
        state = listState,
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(messages) { msg ->
            ChatBubble(msg)
        }
    }
}

@Composable
fun ChatBubble(msg: ChatMessage) {
    val alignment = if (msg.isUser) Alignment.End else Alignment.Start
    val bgColor = if (msg.isUser)
        Color(0xFF6366F1) else MaterialTheme.colorScheme.surfaceVariant
    val textColor = if (msg.isUser) Color.White else MaterialTheme.colorScheme.onSurface

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = alignment,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(bottom = 2.dp),
        ) {
            Text(
                if (msg.isUser) "🎤 You" else "🤖 Hermes",
                fontSize = 11.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                " ${msg.timestamp}",
                fontSize = 10.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
            )
        }
        Box(
            modifier = Modifier
                .widthIn(max = 280.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(bgColor)
                .padding(horizontal = 14.dp, vertical = 10.dp),
        ) {
            Text(
                text = if (msg.interrupted) "${msg.text} ✂️" else msg.text,
                color = textColor,
                fontSize = 15.sp,
            )
        }
    }
}

// ── PTT Button ───────────────────────────────────────────────

@Composable
fun PTTButton(state: PttButtonState, onDown: () -> Unit, onUp: () -> Unit) {
    val infiniteTransition = rememberInfiniteTransition(label = "pulse")

    val buttonColor by animateColorAsState(
        targetValue = when (state) {
            PttButtonState.RECORDING -> Color(0xFFEF4444)
            PttButtonState.PROCESSING -> Color(0xFFF59E0B)
            PttButtonState.PLAYING -> Color(0xFF22C55E)
            else -> Color(0xFF6366F1)
        },
        label = "btnColor",
    )

    val scaleVal = when (state) {
        PttButtonState.RECORDING -> 0.9f
        PttButtonState.PROCESSING -> infiniteTransition.animateFloat(
            initialValue = 1f,
            targetValue = 1.1f,
            animationSpec = infiniteRepeatable(
                animation = tween(600, easing = EaseInOutCubic),
                repeatMode = RepeatMode.Reverse,
            ),
            label = "pulse",
        ).value
        else -> 1f
    }

    val labelText = when (state) {
        PttButtonState.IDLE -> "Hold to Talk"
        PttButtonState.RECORDING -> "Recording…"
        PttButtonState.PROCESSING -> "Thinking…"
        PttButtonState.PLAYING -> "Playing…"
        PttButtonState.INTERRUPTED -> "Interrupted"
    }

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            modifier = Modifier
                .size(80.dp)
                .scale(scaleVal)
                .clip(CircleShape)
                .background(buttonColor)
                .border(3.dp, buttonColor.copy(alpha = 0.4f), CircleShape)
                .pointerInput(Unit) {
                    detectTapGestures(
                        onPress = {
                            onDown()
                            tryAwaitRelease()
                            onUp()
                        }
                    )
                },
            contentAlignment = Alignment.Center,
        ) {
            Text("🎤", fontSize = 32.sp)
        }

        Spacer(Modifier.height(8.dp))

        Text(
            labelText,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

// ── WebSocket + Audio Client ─────────────────────────────────

class PTTWebSocketClient(
    private val appContext: android.content.Context,
    private val wsUrl: String,
    private val cfClientId: String,
    private val cfClientSecret: String,
    private val onStateChange: (ConnectionState) -> Unit,
    private val onPttStateChange: (PttButtonState) -> Unit,
    private val onTranscript: (ChatMessage) -> Unit,
    private val onError: (String) -> Unit,
) {
    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .pingInterval(30, TimeUnit.SECONDS)
        .build()

    private var ws: WebSocket? = null
    private var audioRecord: AudioRecord? = null
    private var recordingJob: Job? = null
    private var scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    private var exoPlayer: ExoPlayer? = null
    private var pipedOut: PipedOutputStream? = null
    private var isPlaying = false
    private var sessionId: String? = null
    private val timeFmt = SimpleDateFormat("HH:mm:ss", Locale.US)

    // ── Async replay state ──────────────────────────────────
    private var lastSeq: Int = 0
    private var reconnectAttempt: Int = 0
    private var reconnectJob: Job? = null
    // Buffer audio chunks during replay so playback is seamless
    private val replayAudioBuffer = ArrayDeque<ByteArray>()

    private fun timestamp() = timeFmt.format(Date())

    fun connect() {
        ApolloLogger.i("connect() — url=$wsUrl")
        onStateChange(ConnectionState.CONNECTING)

        val request = Request.Builder()
            .url(wsUrl)
            .apply {
                if (cfClientId.isNotBlank()) addHeader("CF-Access-Client-Id", cfClientId)
                if (cfClientSecret.isNotBlank()) addHeader("CF-Access-Client-Secret", cfClientSecret)
            }
            .build()

        ws = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                ApolloLogger.i("WebSocket OPEN — protocol=${response.protocol} code=${response.code}")
                onStateChange(ConnectionState.CONNECTED)
                reconnectAttempt = 0
                // Send reconnect handshake with session state
                val handshake = JSONObject().apply {
                    put("type", "reconnect")
                    put("session_id", sessionId ?: "")
                    put("last_seq", lastSeq)
                }
                val msg = handshake.toString()
                ApolloLogger.i("Sending handshake: $msg")
                ws.send(msg)
            }

            override fun onMessage(ws: WebSocket, text: String) {
                ApolloLogger.d("TEXT ← ${text.take(200)}")
                handleText(text)
            }

            override fun onMessage(ws: WebSocket, bytes: ByteString) {
                ApolloLogger.d("BINARY ← ${bytes.size} bytes")
                handleBinary(bytes.toByteArray())
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                ApolloLogger.e("WebSocket FAILURE — ${t.message}", t)
                if (response != null) {
                    ApolloLogger.e("  response code=${response.code} body=${response.body?.string()?.take(200)}")
                }
                onStateChange(ConnectionState.DISCONNECTED)
                onPttStateChange(PttButtonState.IDLE)
                stopPlayback()
                scheduleReconnect()
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                ApolloLogger.i("WebSocket CLOSED — code=$code reason=$reason")
                onStateChange(ConnectionState.DISCONNECTED)
                onPttStateChange(PttButtonState.IDLE)
                scheduleReconnect()
            }
        })
    }

    fun disconnect() {
        ApolloLogger.i("disconnect()")
        stopRecording()
        stopPlayback()
        reconnectJob?.cancel()
        reconnectJob = null
        ws?.close(1000, "User disconnect")
        ws = null
        onStateChange(ConnectionState.DISCONNECTED)
        scope.cancel()
    }

    // ── Auto-reconnect ─────────────────────────────────────

    private fun scheduleReconnect() {
        reconnectJob?.cancel()
        val delay = minOf(
            BASE_RECONNECT_DELAY_MS * (1L shl reconnectAttempt.coerceAtMost(5)),
            MAX_RECONNECT_DELAY_MS,
        )
        reconnectAttempt++
        ApolloLogger.i("scheduleReconnect() — attempt=$reconnectAttempt delay=${delay}ms")
        reconnectJob = scope.launch {
            delay(delay)
            connect()
        }
    }

    // ── Seq ack tick ───────────────────────────────────────

    private var ackJob: Job? = null

    private fun startAckTicker() {
        ApolloLogger.d("startAckTicker()")
        ackJob?.cancel()
        ackJob = scope.launch {
            while (isActive) {
                delay(5_000)  // ack every 5 seconds
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
        ApolloLogger.d("ACK → seq=$lastSeq")
        ws?.send(ack.toString())
    }

    // ── Barge-in ─────────────────────────────────────────

    fun interrupt() {
        ApolloLogger.i("interrupt() — session=$sessionId")
        stopPlayback()
        ws?.send(JSONObject().apply { put("type", "interrupt") }.toString())
        onPttStateChange(PttButtonState.INTERRUPTED)
        ApolloLogger.i("interrupt sent")
    }

    // ── Recording ────────────────────────────────────────

    fun startRecording() {
        ApolloLogger.i("startRecording() — audioRecord=${audioRecord != null}")
        if (audioRecord != null) {
            ApolloLogger.w("startRecording: already recording, returning")
            return
        }

        val bufferSize = maxOf(
            AudioRecord.getMinBufferSize(
                SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT
            ),
            AUDIO_BUFFER_SIZE * 4,
        )
        ApolloLogger.i("AudioRecord bufferSize=$bufferSize")

        try {
            audioRecord = AudioRecord(
                MediaRecorder.AudioSource.MIC,
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                bufferSize,
            ).apply {
                val state = state
                ApolloLogger.i("AudioRecord created, initial state=$state")
                startRecording()
                ApolloLogger.i("AudioRecord started, state=$recordingState")
            }

            onPttStateChange(PttButtonState.RECORDING)

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
                        ApolloLogger.w("AudioRecord.read returned $bytesRead")
                    }
                }
                ApolloLogger.i("Recording loop ended: $frames frames, $totalBytes bytes")
            }
            ApolloLogger.i("Recording coroutine launched")
        } catch (e: Exception) {
            ApolloLogger.e("startRecording failed", e)
            onError("Audio error: ${e.message}")
            onPttStateChange(PttButtonState.IDLE)
            audioRecord?.release()
            audioRecord = null
        }
    }

    fun stopRecording() {
        ApolloLogger.i("stopRecording()")
        recordingJob?.cancel()
        recordingJob = null
        try {
            audioRecord?.stop()
            ApolloLogger.i("AudioRecord stopped")
        } catch (e: Exception) {
            ApolloLogger.e("AudioRecord.stop exception", e)
        }
        audioRecord?.release()
        audioRecord = null

        ws?.send(JSONObject().apply { put("type", "ptt_end") }.toString())
        ApolloLogger.i("ptt_end sent")
        onPttStateChange(PttButtonState.PROCESSING)
    }

    // ── Text message handling ────────────────────────────

    private fun handleText(text: String) {
        try {
            val json = JSONObject(text)
            val type = json.optString("type", "?")
            ApolloLogger.d("handleText: type=$type")

            // Track sequence number on every server message
            val seq = json.optInt("seq", 0)
            if (seq > lastSeq) {
                lastSeq = seq
            }

            when (type) {
                "reconnect_done" -> {
                    val replayed = json.optBoolean("replayed", false)
                    ApolloLogger.i("reconnect_done — replayed=$replayed sessionId=$sessionId")
                    startAckTicker()
                    if (replayed) {
                        val complete = json.optBoolean("complete", false)
                        val interrupted = json.optBoolean("interrupted", false)
                        ApolloLogger.i("  replay: complete=$complete interrupted=$interrupted")
                    }
                }
                "stt_transcript" -> {
                    val t = json.optString("text", "")
                    ApolloLogger.i("STT transcript (${t.length} chars)")
                    onTranscript(ChatMessage(text = t, isUser = true, timestamp = timestamp()))
                }
                "tts_start" -> {
                    val t = json.optString("text", "")
                    ApolloLogger.i("TTS start (${t.length} chars)")
                    onPttStateChange(PttButtonState.PLAYING)
                    onTranscript(ChatMessage(text = t, isUser = false, timestamp = timestamp()))
                    // Drain any buffered replay audio before starting fresh playback
                    if (replayAudioBuffer.isNotEmpty()) {
                        ApolloLogger.i("  draining ${replayAudioBuffer.size} buffered chunks")
                        startPlayback()
                        while (replayAudioBuffer.isNotEmpty()) {
                            val chunk = replayAudioBuffer.removeFirst()
                            try {
                                pipedOut?.write(chunk)
                                pipedOut?.flush()
                            } catch (_: IOException) { }
                        }
                    } else {
                        startPlayback()
                    }
                }
                "tts_end" -> {
                    ApolloLogger.i("TTS end")
                    stopPlayback()
                    replayAudioBuffer.clear()
                    onPttStateChange(PttButtonState.IDLE)
                }
                "tts_fallback" -> {
                    val t = json.optString("text", "") + " 🔇"
                    ApolloLogger.i("TTS fallback (no audio)")
                    onPttStateChange(PttButtonState.IDLE)
                    onTranscript(ChatMessage(text = t, isUser = false, timestamp = timestamp()))
                    replayAudioBuffer.clear()
                }
                "processing" -> {
                    val step = json.optString("step", "")
                    ApolloLogger.d("processing step=$step")
                }
                "session_id" -> {
                    sessionId = json.optString("id", "")
                    ApolloLogger.i("session_id received: $sessionId")
                }
                "interrupted" -> {
                    ApolloLogger.i("Server confirmed interrupt")
                    stopPlayback()
                    replayAudioBuffer.clear()
                    onPttStateChange(PttButtonState.IDLE)
                }
                "error" -> {
                    val msg = json.optString("message", "Unknown error")
                    ApolloLogger.e("Server error: $msg")
                    onPttStateChange(PttButtonState.IDLE)
                    onError("Apollo: $msg")
                }
                "ping" -> { /* keepalive — no action */ }
                "pong" -> { /* keepalive response */ }
                else -> {
                    ApolloLogger.w("Unknown message type: $type — $text")
                }
            }
        } catch (e: Exception) {
            ApolloLogger.e("handleText parse error", e)
        }
    }

    // ── Audio playback ───────────────────────────────────

    @OptIn(UnstableApi::class)
    private fun startPlayback() {
        ApolloLogger.i("startPlayback() — isPlaying=$isPlaying")
        if (isPlaying) {
            ApolloLogger.w("startPlayback: already playing, returning")
            return
        }
        isPlaying = true

        try {
            val pipedIn = PipedInputStream()
            pipedOut = PipedOutputStream(pipedIn)

            val ds = object : DataSource {
                private var position = 0L
                override fun open(dataSpec: DataSpec): Long {
                    position = 0
                    return Long.MAX_VALUE
                }
                override fun read(buffer: ByteArray, offset: Int, count: Int): Int {
                    return pipedIn.read(buffer, offset, count)
                }
                override fun getUri() = null
                override fun close() {}
                override fun addTransferListener(listener: TransferListener) {}
            }

            exoPlayer = ExoPlayer.Builder(appContext).build().apply {
                val mi = MediaItem.Builder().setMimeType(MimeTypes.AUDIO_OGG).build()
                setMediaSource(ProgressiveMediaSource.Factory { ds }.createMediaSource(mi))
                prepare()
                playWhenReady = true
                ApolloLogger.i("ExoPlayer prepared")
            }
        } catch (e: Exception) {
            ApolloLogger.e("startPlayback failed", e)
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
                ApolloLogger.w("handleBinary: pipe write error — ${e.message}")
            }
        } else {
            ApolloLogger.d("handleBinary: buffering ${data.size} bytes (isPlaying=$isPlaying)")
            replayAudioBuffer.addLast(data)
        }
    }

    private fun stopPlayback() {
        ApolloLogger.i("stopPlayback()")
        isPlaying = false
        try {
            exoPlayer?.stop()
            exoPlayer?.release()
        } catch (e: Exception) {
            ApolloLogger.e("ExoPlayer stop/release error", e)
        }
        exoPlayer = null
        try { pipedOut?.close() } catch (_: IOException) { }
        pipedOut = null
    }
}

// ── Theme ────────────────────────────────────────────────────

@Composable
fun ApolloTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Color(0xFF6366F1),
            onPrimary = Color.White,
            surface = Color(0xFF1C1C1E),
            onSurface = Color(0xFFF2F2F7),
            surfaceVariant = Color(0xFF2C2C2E),
            onSurfaceVariant = Color(0xFFAEAEB2),
            background = Color(0xFF000000),
            onBackground = Color(0xFFF2F2F7),
        ),
        content = content,
    )
}
