package com.reedsutliff.apollo.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.reedsutliff.apollo.data.entities.MessageEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface MessageDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(message: MessageEntity)

    @Query("UPDATE messages SET status = :newStatus WHERE run_id = :runId")
    suspend fun updateStatus(runId: String, newStatus: String)

    @Query("SELECT * FROM messages WHERE thread_id = :threadId ORDER BY timestamp ASC")
    fun getByThreadId(threadId: String): Flow<List<MessageEntity>>

    @Query("SELECT * FROM messages WHERE thread_id = :threadId ORDER BY timestamp DESC LIMIT 1")
    suspend fun getLatestByThreadId(threadId: String): MessageEntity?

    @Query("DELETE FROM messages WHERE thread_id = :threadId")
    suspend fun deleteByThreadId(threadId: String)
}
