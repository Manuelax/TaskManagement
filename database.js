// database.js
const sqlite3 = require('sqlite3').verbose();

// Use a new distinct name for the database file
const DB_PATH = './tasks_boards.db';

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database (tasks_boards.db).');
        initializeDatabase();
    }
});

function initializeDatabase() {
    db.serialize(() => {
        // Users table for authentication
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            passwordHash TEXT NOT NULL, -- Store hashed passwords, not plain text!
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) console.error('Error creating users table:', err.message);
            else console.log('Users table ready.');
        });

        // Boards table
        db.run(`CREATE TABLE IF NOT EXISTS boards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            ownerUserId INTEGER NOT NULL, -- Link to the user who created it
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (ownerUserId) REFERENCES users(id) ON DELETE CASCADE
        )`, (err) => {
            if (err) console.error('Error creating boards table:', err.message);
            else console.log('Boards table ready.');
        });

        // Tasks table - now linked to a specific board
        db.run(`CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            boardId INTEGER NOT NULL,         -- Which board this task belongs to
            title TEXT NOT NULL,
            completed BOOLEAN NOT NULL DEFAULT 0,
            assignedTo TEXT DEFAULT NULL,     -- Stores the nickname/username assigned
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (boardId) REFERENCES boards(id) ON DELETE CASCADE
        )`, (err) => {
            if (err) console.error('Error creating tasks table:', err.message);
            else console.log('Tasks table ready (with boardId).');
        });
    });
}

module.exports = db;