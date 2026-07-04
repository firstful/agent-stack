package com.reedsutliff.apollo.model

import java.util.UUID

enum class MessageModality { VOICE, TEXT }

enum class MessageStatus { SENDING, SENT, DELIVERED, ERROR }

data class ChatMessage(
    val id: String = UUID.randomUUID().toString(),
    val threadId: String,
    val text: String,
    val isUser: Boolean,
    val modality: MessageModality,
    val status: MessageStatus = MessageStatus.SENT,
    val timestamp: Long = System.currentTimeMillis(),
    val interrupted: Boolean = false,
    val runId: String? = null
)
