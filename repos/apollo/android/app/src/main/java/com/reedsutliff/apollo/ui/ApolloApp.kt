package com.reedsutliff.apollo.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.reedsutliff.apollo.model.ChatMessage
import com.reedsutliff.apollo.model.ConnectionState
import com.reedsutliff.apollo.model.MessageModality
import com.reedsutliff.apollo.model.PttButtonState
import kotlinx.coroutines.launch

/**
 * Top-level composable for Apollo v2.
 * Hosts the ApolloViewModel and assembles the full UI:
 * TopAppBar → ThreadSwitcher → ChatTranscript → TextInputBar/PTTButton.
 *
 * All state lives in [ApolloViewModel].
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApolloApp(
    viewModel: ApolloViewModel = viewModel(),
) {
    val connectionState by viewModel.connectionState.collectAsState()
    val pttState by viewModel.pttState.collectAsState()
    val messages by viewModel.messages.collectAsState()
    val currentThread by viewModel.currentThread.collectAsState()
    val threadList by viewModel.threadList.collectAsState()
    val inputMode by viewModel.inputMode.collectAsState()
    val settings by viewModel.settings.collectAsState()
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    var showSettings by remember { mutableStateOf(false) }
    val context = LocalContext.current

    // Auto-connect on first composition
    LaunchedEffect(Unit) {
        viewModel.connect()
    }

    // Cleanup on dispose
    DisposableEffect(Unit) {
        onDispose { viewModel.disconnect() }
    }

    // Auto-scroll to bottom when new messages arrive
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) {
            listState.animateScrollToItem(messages.size - 1)
        }
    }

    // ── Connection dot color ──────────────────────────────────
    val dotColor = when (connectionState) {
        ConnectionState.CONNECTED -> Color(0xFF22C55E)
        ConnectionState.CONNECTING -> Color(0xFFEAB308)
        ConnectionState.DISCONNECTED -> Color(0xFFEF4444)
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            ApolloDrawerContent(
                threads = threadList,
                currentThreadId = currentThread?.id,
                connectionState = connectionState,
                settings = settings,
                onSwitchThread = { viewModel.switchThread(it) },
                onCreateThread = { viewModel.createThread("New Thread") },
                onDeleteThread = { viewModel.deleteThread(it) },
                onOpenSettings = {
                    scope.launch { drawerState.close() }
                    showSettings = true
                },
                onReconnect = { viewModel.connect() },
                onDisconnect = { viewModel.disconnect() },
                onShareLogs = { viewModel.shareLogs(context) },
            )
        },
    ) {
        if (showSettings) {
            SettingsScreen(
                settings = settings,
                onUpdateSettings = { viewModel.updateSettings(it) },
                onBack = { showSettings = false },
            )
        } else {
            Scaffold(
                topBar = {
                    TopAppBar(
                        title = {
                            Text(
                                text = "Apollo",
                                fontWeight = FontWeight.Bold,
                            )
                        },
                        navigationIcon = {
                            IconButton(onClick = {
                                scope.launch { drawerState.open() }
                            }) {
                                Icon(
                                    imageVector = Icons.Default.Menu,
                                    contentDescription = "Open navigation drawer",
                                )
                            }
                        },
                        actions = {
                            // Connection status dot
                            Box(
                                modifier = Modifier
                                    .size(12.dp)
                                    .clip(CircleShape)
                                    .background(dotColor),
                            )
                            Spacer(Modifier.width(12.dp))
                            // Settings icon
                            IconButton(onClick = {
                                scope.launch { drawerState.open() }
                            }) {
                                Icon(
                                    imageVector = Icons.Default.Settings,
                                    contentDescription = "Settings",
                                )
                            }
                        },
                        colors = TopAppBarDefaults.topAppBarColors(
                            containerColor = MaterialTheme.colorScheme.surface,
                            titleContentColor = MaterialTheme.colorScheme.onSurface,
                        ),
                    )
                },
            ) { padding ->
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(padding)
                        .padding(horizontal = 16.dp),
                ) {
                    // ThreadSwitcher chip
                    ThreadSwitcher(
                        threads = threadList,
                        currentThread = currentThread,
                        onSwitchThread = { viewModel.switchThread(it) },
                        onCreateThread = { viewModel.createThread(it) },
                        onDeleteThread = { viewModel.deleteThread(it) },
                        modifier = Modifier.padding(vertical = 4.dp),
                    )

                    Spacer(Modifier.height(8.dp))

                    // Chat transcript
                    ChatTranscript(
                        messages = messages,
                        listState = listState,
                        modifier = Modifier.weight(1f),
                    )

                    Spacer(Modifier.height(16.dp))

                    // Input area
                    when (inputMode) {
                        InputMode.VOICE -> {
                            PTTButton(
                                state = pttState,
                                onDown = { viewModel.startPtt() },
                                onUp = { viewModel.stopPtt() },
                            )
                        }
                        InputMode.TEXT -> {
                            TextInputBar(
                                onSend = { viewModel.sendText(it) },
                                onToggleMode = {
                                    viewModel.setInputMode(InputMode.VOICE)
                                },
                                isTextMode = true,
                            )
                        }
                    }

                    // Input mode toggle hint — tappable to switch modes
                    Text(
                        text = when (inputMode) {
                            InputMode.VOICE -> "Tap to type"
                            InputMode.TEXT -> "Hold to talk"
                        },
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 4.dp)
                            .clickable {
                                viewModel.setInputMode(
                                    if (inputMode == InputMode.VOICE) InputMode.TEXT
                                    else InputMode.VOICE
                                )
                            },
                        textAlign = TextAlign.Center,
                    )

                    // Version footer
                    Text(
                        "Apollo v2",
                        fontSize = 10.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 4.dp, bottom = 8.dp),
                        textAlign = TextAlign.Center,
                    )
                }
            }
        }
    }
}

// ── Chat Transcript ──────────────────────────────────────────

@Composable
fun ChatTranscript(
    messages: List<ChatMessage>,
    listState: LazyListState,
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
        items(messages, key = { it.id }) { msg ->
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

    // Format timestamp
    val timeText = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US)
        .format(java.util.Date(msg.timestamp))

    // Modality badge
    val modalityBadge = when (msg.modality) {
        MessageModality.VOICE -> "\uD83C\uDFA4"
        MessageModality.TEXT -> "\u2328"
    }

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = alignment,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(bottom = 2.dp),
        ) {
            Text(
                text = "$modalityBadge ${if (msg.isUser) "You" else "Hermes"}",
                fontSize = 11.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = " $timeText",
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
fun PTTButton(
    state: PttButtonState,
    onDown: () -> Unit,
    onUp: () -> Unit,
) {
    val buttonColor = when (state) {
        PttButtonState.RECORDING -> Color(0xFFEF4444)
        PttButtonState.PROCESSING -> Color(0xFFF59E0B)
        PttButtonState.PLAYING -> Color(0xFF22C55E)
        else -> Color(0xFF6366F1)
    }

    // ── Pulse animation ──────────────────────────────────────
    val isActive = state == PttButtonState.RECORDING ||
            state == PttButtonState.PROCESSING ||
            state == PttButtonState.PLAYING

    val transition = rememberInfiniteTransition(label = "pulse")
    val pulseAlpha by transition.animateFloat(
        initialValue = 0.4f,
        targetValue = if (isActive) 0.9f else 0.4f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 600),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "pulseAlpha",
    )
    val pulseScale by transition.animateFloat(
        initialValue = 1f,
        targetValue = if (isActive) 1.12f else 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 600),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "pulseScale",
    )

    val labelText = when (state) {
        PttButtonState.IDLE -> "Hold to Talk"
        PttButtonState.RECORDING -> "Recording…"
        PttButtonState.PROCESSING -> "Thinking…"
        PttButtonState.PLAYING -> "Playing…"
        PttButtonState.INTERRUPTED -> "Interrupted"
    }

    // Icon changes with state
    val iconText = when (state) {
        PttButtonState.RECORDING -> "\uD83D\uDD34"   // red circle
        PttButtonState.PROCESSING -> "\u23F3"          // hourglass
        PttButtonState.PLAYING -> "\uD83D\uDD0A"       // speaker
        PttButtonState.INTERRUPTED -> "\u270B"         // raised hand
        else -> "\uD83C\uDFA4"                         // microphone
    }

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            modifier = Modifier
                .size(80.dp)
                .scale(pulseScale)
                .clip(CircleShape)
                .background(buttonColor)
                .border(3.dp, buttonColor.copy(alpha = pulseAlpha), CircleShape)
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
            Text(iconText, fontSize = 32.sp)
        }

        Spacer(Modifier.height(8.dp))

        Text(
            labelText,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )

        // Extra visual meter during recording
        if (state == PttButtonState.RECORDING) {
            Spacer(Modifier.height(6.dp))
            Row(
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Animated audio level bars
                val barAlpha by rememberInfiniteTransition(label = "bar").animateFloat(
                    initialValue = 0.3f,
                    targetValue = 1f,
                    animationSpec = infiniteRepeatable(
                        animation = tween(durationMillis = 400),
                        repeatMode = RepeatMode.Reverse,
                    ),
                    label = "barAlpha",
                )
                repeat(3) { i ->
                    val delay = i * 133
                    val barAnim by rememberInfiniteTransition(label = "bar$i").animateFloat(
                        initialValue = 0.3f,
                        targetValue = 1f,
                        animationSpec = infiniteRepeatable(
                            animation = tween(durationMillis = 400, delayMillis = delay),
                            repeatMode = RepeatMode.Reverse,
                        ),
                        label = "barAnim$i",
                    )
                    Box(
                        modifier = Modifier
                            .width(6.dp)
                            .height(20.dp * barAnim)
                            .clip(RoundedCornerShape(3.dp))
                            .background(Color(0xFFEF4444).copy(alpha = barAnim)),
                    )
                }
            }
        }
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
