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
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.*
import okio.*
import org.json.JSONObject
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
        if (!granted) {
            Toast.makeText(this, "Microphone permission required", Toast.LENGTH_LONG).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED) {
            permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }

        setContent {
            ApolloTheme {
                ApolloApp(context = this)
            }
        }
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
        wsClient.connect()
    }

    // Cleanup on dispose
    androidx.compose.runtime.DisposableEffect(Unit) {
        onDispose { wsClient.disconnect() }
    }

    fun onPttDown() {
        if (connectionState != ConnectionState.CONNECTED) {
            wsClient.connect()
            return
        }
        val vibrator = context.getSystemService(android.content.Context.VIBRATOR_SERVICE) as Vibrator
        vibrator.vibrate(VibrationEffect.createOneShot(30, VibrationEffect.DEFAULT_AMPLITUDE))

        // Barge-in: interrupt if processing or playing
        if (pttState == PttButtonState.PROCESSING || pttState == PttButtonState.PLAYING) {
            wsClient.interrupt()
        }

        wsClient.startRecording()
    }

    fun onPttUp() {
        if (pttState == PttButtonState.RECORDING) {
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

    private fun timestamp() = timeFmt.format(Date())

    fun connect() {
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
                onStateChange(ConnectionState.CONNECTED)
            }

            override fun onMessage(ws: WebSocket, text: String) {
                handleText(text)
            }

            override fun onMessage(ws: WebSocket, bytes: ByteString) {
                handleBinary(bytes.toByteArray())
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                onStateChange(ConnectionState.DISCONNECTED)
                onPttStateChange(PttButtonState.IDLE)
                stopPlayback()
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                onStateChange(ConnectionState.DISCONNECTED)
                onPttStateChange(PttButtonState.IDLE)
            }
        })
    }

    fun disconnect() {
        stopRecording()
        stopPlayback()
        ws?.close(1000, "User disconnect")
        ws = null
        onStateChange(ConnectionState.DISCONNECTED)
        scope.cancel()
    }

    // ── Barge-in ─────────────────────────────────────────

    fun interrupt() {
        stopPlayback()
        ws?.send(JSONObject().apply { put("type", "interrupt") }.toString())
        onPttStateChange(PttButtonState.INTERRUPTED)
    }

    // ── Recording ────────────────────────────────────────

    fun startRecording() {
        if (audioRecord != null) return

        val bufferSize = maxOf(
            AudioRecord.getMinBufferSize(
                SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT
            ),
            AUDIO_BUFFER_SIZE * 4,
        )

        audioRecord = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            bufferSize,
        ).apply { startRecording() }

        onPttStateChange(PttButtonState.RECORDING)

        recordingJob = scope.launch {
            val buf = ByteArray(AUDIO_BUFFER_SIZE)
            while (isActive && audioRecord?.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
                val bytesRead = audioRecord?.read(buf, 0, AUDIO_BUFFER_SIZE) ?: -1
                if (bytesRead > 0) {
                    val ob = okio.Buffer()
                    ob.write(buf, 0, bytesRead)
                    ws?.send(ob.readByteString())
                }
            }
        }
    }

    fun stopRecording() {
        recordingJob?.cancel()
        recordingJob = null
        audioRecord?.stop()
        audioRecord?.release()
        audioRecord = null

        ws?.send(JSONObject().apply { put("type", "ptt_end") }.toString())
        onPttStateChange(PttButtonState.PROCESSING)
    }

    // ── Text message handling ────────────────────────────

    private fun handleText(text: String) {
        try {
            val json = JSONObject(text)
            when (json.optString("type")) {
                "stt_transcript" -> {
                    val t = json.optString("text", "")
                    onTranscript(ChatMessage(text = t, isUser = true, timestamp = timestamp()))
                }
                "tts_start" -> {
                    val t = json.optString("text", "")
                    onPttStateChange(PttButtonState.PLAYING)
                    onTranscript(ChatMessage(text = t, isUser = false, timestamp = timestamp()))
                    startPlayback()
                }
                "tts_end" -> {
                    stopPlayback()
                    onPttStateChange(PttButtonState.IDLE)
                }
                "tts_fallback" -> {
                    val t = json.optString("text", "") + " 🔇"
                    onPttStateChange(PttButtonState.IDLE)
                    onTranscript(ChatMessage(text = t, isUser = false, timestamp = timestamp()))
                }
                "session_id" -> {
                    sessionId = json.optString("id", "")
                }
                "interrupted" -> {
                    stopPlayback()
                    onPttStateChange(PttButtonState.IDLE)
                }
                "error" -> {
                    onPttStateChange(PttButtonState.IDLE)
                    onError("Apollo: ${json.optString("message", "Unknown error")}")
                }
                "ping" -> { /* keepalive — no action */ }
            }
        } catch (_: Exception) { }
    }

    // ── Audio playback ───────────────────────────────────

    @OptIn(UnstableApi::class)
    private fun startPlayback() {
        if (isPlaying) return
        isPlaying = true

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
        }
    }

    private fun handleBinary(data: ByteArray) {
        try {
            pipedOut?.write(data)
            pipedOut?.flush()
        } catch (_: IOException) { }
    }

    private fun stopPlayback() {
        isPlaying = false
        exoPlayer?.stop()
        exoPlayer?.release()
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
