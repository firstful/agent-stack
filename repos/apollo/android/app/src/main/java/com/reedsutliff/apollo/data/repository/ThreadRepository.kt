package com.reedsutliff.apollo.data.repository

import com.reedsutliff.apollo.data.dao.MessageDao
import com.reedsutliff.apollo.data.dao.ThreadDao
import com.reedsutliff.apollo.data.entities.MessageEntity
import com.reedsutliff.apollo.data.entities.ThreadEntity
import kotlinx.coroutines.flow.Flow
import java.util.UUID

class ThreadRepository(
    private val threadDao: ThreadDao,
    private val messageDao: MessageDao,
) {

    val allThreads: Flow<List<ThreadEntity>> = threadDao.getAll()

    suspend fun createThread(name: String): ThreadEntity {
        val now = System.currentTimeMillis()
        val thread = ThreadEntity(
            id = UUID.randomUUID().toString(),
            name = name,
            lastMessageTimestamp = now,
            createdAt = now,
        )
        threadDao.insert(thread)
        return thread
    }

    suspend fun deleteThread(id: String) {
        val thread = threadDao.getById(id) ?: return
        messageDao.deleteByThreadId(id)
        threadDao.delete(thread)
    }

    suspend fun switchThread(id: String): ThreadEntity? {
        return threadDao.getById(id)
    }

    fun getMessages(threadId: String): Flow<List<MessageEntity>> {
        return messageDao.getByThreadId(threadId)
    }

    suspend fun insertMessage(message: MessageEntity) {
        messageDao.insert(message)
    }

    suspend fun updateMessageStatus(runId: String, newStatus: String) {
        messageDao.updateStatus(runId, newStatus)
    }
}
