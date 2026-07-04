package com.reedsutliff.apollo.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import com.reedsutliff.apollo.data.dao.MessageDao
import com.reedsutliff.apollo.data.dao.ThreadDao
import com.reedsutliff.apollo.data.entities.MessageEntity
import com.reedsutliff.apollo.data.entities.ThreadEntity

@Database(
    entities = [ThreadEntity::class, MessageEntity::class],
    version = 1,
    exportSchema = false,
)
abstract class AppDatabase : RoomDatabase() {

    abstract fun threadDao(): ThreadDao
    abstract fun messageDao(): MessageDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "apollo.db",
                ).build().also { INSTANCE = it }
            }
        }
    }
}
