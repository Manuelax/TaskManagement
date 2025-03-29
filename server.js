// server.js
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcrypt');
const db = require('./database.js'); // Uses the updated database.js

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const SALT_ROUNDS = 10; // For bcrypt password hashing

// --- Middleware ---
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files (HTML, CSS, JS)
app.use(express.json()); // For parsing JSON bodies in POST requests (APIs)
app.use(express.urlencoded({ extended: true })); // For parsing form data in POST requests (Login/Register)

// Session Configuration - VERY IMPORTANT
app.use(session({
    store: new SQLiteStore({ db: 'sessions.db', dir: '.' }), // Store sessions in sessions.db file
    secret: 'replace_this_with_a_real_secret_key_12345!', // **** CHANGE THIS KEY TO SOMETHING RANDOM AND SECRET ****
    resave: false, // Don't save session if unmodified
    saveUninitialized: false, // Don't create session until something stored
    cookie: {
        maxAge: 7 * 24 * 60 * 60 * 1000, // Cookie valid for 1 week
        httpOnly: true, // Prevent client-side JS from accessing cookie
        // secure: process.env.NODE_ENV === 'production', // Use secure cookies in production (HTTPS)
        sameSite: 'lax' // Protect against CSRF
    }
}));

// Middleware to make user info available in templates/responses if logged in
app.use((req, res, next) => {
    res.locals.user = req.session.user || null; // Make user available to potential view engines
    // console.log('Session User:', req.session.user); // Debugging: Check session data
    next();
});

// Middleware function to protect routes that require a user to be logged in
function requireLogin(req, res, next) {
    if (!req.session.user) {
        // If the request expects JSON (API call), send error status
        if (req.accepts('json') && !req.accepts('html')) {
            return res.status(401).json({ error: 'Authentication required.' });
        }
        // Otherwise, redirect to the login page
        return res.redirect('/login');
    }
    next(); // User is logged in, proceed to the route handler
}

// --- HTML Page Routes ---

// Root route: Show dashboard if logged in, otherwise show landing page
app.get('/', (req, res) => {
    if (req.session.user) {
        res.sendFile(path.join(__dirname, 'public', 'dashboard.html')); // Logged in users see their boards
    } else {
        res.sendFile(path.join(__dirname, 'public', 'landing.html')); // Not logged in? Show welcome/login page
    }
});

// Login page route
app.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/'); // Already logged in? Go to dashboard
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Registration page route
app.get('/register', (req, res) => {
    if (req.session.user) return res.redirect('/'); // Already logged in? Go to dashboard
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// Specific Board page route - accessible by anyone with the link
app.get('/board/:boardId', (req, res) => {
    const boardId = parseInt(req.params.boardId, 10);
    if (isNaN(boardId)) {
        return res.status(400).send("Invalid Board ID format.");
    }

    // Check if the board actually exists in the database
    db.get('SELECT id FROM boards WHERE id = ?', [boardId], (err, board) => {
        if (err) {
            console.error(`Error checking existence of board ${boardId}:`, err.message);
            return res.status(500).send("Server error checking board.");
        }
        if (!board) {
            return res.status(404).send("Board not found."); // Board doesn't exist
        }
        // Board exists, serve the HTML file. Client-side JS will handle the rest.
        res.sendFile(path.join(__dirname, 'public', 'board.html'));
    });
});


// --- API Routes (for JavaScript fetch calls) ---

// API: Get boards for the currently logged-in user (for dashboard)
app.get('/api/boards', requireLogin, (req, res) => {
    const userId = req.session.user.id;
    db.all('SELECT id, name FROM boards WHERE ownerUserId = ? ORDER BY createdAt DESC',
        [userId], (err, boards) => {
        if (err) {
            console.error("API Error fetching user's boards:", err.message);
            return res.status(500).json({ error: "Failed to fetch boards" });
        }
        res.json(boards || []); // Send board list (or empty array) as JSON
    });
});

// API: Create a new board
app.post('/api/boards', requireLogin, (req, res) => {
    const { boardName } = req.body;
    const userId = req.session.user.id;

    if (!boardName || typeof boardName !== 'string' || boardName.trim().length < 1 || boardName.trim().length > 100) {
        return res.status(400).json({ error: 'Invalid board name (1-100 characters).' });
    }
    const trimmedName = boardName.trim();

    const sql = 'INSERT INTO boards (name, ownerUserId) VALUES (?, ?)';
    db.run(sql, [trimmedName, userId], function(err) {
        if (err) {
            console.error("API Error creating board:", err.message);
            return res.status(500).json({ error: "Failed to create board" });
        }
        // Send back the details of the newly created board
        res.status(201).json({ id: this.lastID, name: trimmedName });
    });
});

// API: Get details (like name) for a specific board (used by board.html)
app.get('/api/board/:boardId/details', (req, res) => {
    const boardId = parseInt(req.params.boardId, 10);
    if (isNaN(boardId)) {
        return res.status(400).json({ error: 'Invalid Board ID format' });
    }

    db.get('SELECT id, name FROM boards WHERE id = ?', [boardId], (err, board) => {
        if (err) {
            console.error(`API error fetching details for board ${boardId}:`, err.message);
            return res.status(500).json({ error: 'Database error fetching board details' });
        }
        if (!board) {
            return res.status(404).json({ error: 'Board not found' });
        }
        res.json(board); // Send { id, name }
    });
});


// --- Authentication Routes ---

// POST Login
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).send('Username and password are required.'); // Or render login with error
    }

    db.get('SELECT id, username, passwordHash FROM users WHERE username = ?', [username], async (err, user) => {
        if (err) {
            console.error("Login DB error:", err.message);
            return res.status(500).send("Server error during login.");
        }
        if (!user) {
            // User not found - generic error message is safer
            console.warn(`Login attempt failed: Username not found - ${username}`);
            return res.status(401).send("Invalid username or password.");
        }

        // Compare submitted password with the stored hash
        try {
            const match = await bcrypt.compare(password, user.passwordHash);
            if (match) {
                // Passwords match! Store user info in session
                req.session.user = { id: user.id, username: user.username };
                console.log(`User logged in: ${user.username} (ID: ${user.id})`);
                req.session.save(err => { // Explicitly save session before redirect
                   if (err) {
                       console.error("Session save error on login:", err);
                       return res.status(500).send("Login failed due to session error.");
                   }
                   res.redirect('/'); // Redirect to dashboard
                });
            } else {
                // Passwords don't match - generic error message
                console.warn(`Login attempt failed: Invalid password for user ${username}`);
                res.status(401).send("Invalid username or password.");
            }
        } catch (compareError) {
             console.error("Error comparing password hash:", compareError);
             res.status(500).send("Server error during login processing.");
        }
    });
});

// POST Register
app.post('/register', async (req, res) => {
    const { username, password } = req.body;

    // Basic validation
    if (!username || !password || username.trim().length < 3 || password.length < 6) {
        return res.status(400).send('Username must be at least 3 characters, password at least 6 characters.');
    }
    const trimmedUsername = username.trim();

    // Check if username already exists
    db.get('SELECT id FROM users WHERE username = ?', [trimmedUsername], async (err, existingUser) => {
        if (err) {
            console.error("Register check DB error:", err.message);
            return res.status(500).send("Server error during registration check.");
        }
        if (existingUser) {
            return res.status(409).send("Username already taken. Please choose another."); // 409 Conflict
        }

        // Username is available, hash the password
        try {
            const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

            // Insert the new user into the database
            const insertSql = 'INSERT INTO users (username, passwordHash) VALUES (?, ?)';
            db.run(insertSql, [trimmedUsername, passwordHash], function(insertErr) {
                if (insertErr) {
                    console.error("Register insert DB error:", insertErr.message);
                    return res.status(500).send("Failed to register user.");
                }
                const newUserId = this.lastID;
                console.log(`User registered: ${trimmedUsername} (ID: ${newUserId})`);

                // Automatically log the user in after registration
                req.session.user = { id: newUserId, username: trimmedUsername };
                 req.session.save(err => { // Explicitly save session before redirect
                    if (err) {
                        console.error("Session save error on registration:", err);
                        // Registration succeeded but login failed - might want to inform user
                        return res.redirect('/login'); // Send to login page as fallback
                    }
                    res.redirect('/'); // Redirect to dashboard
                 });
            });
        } catch (hashError) {
            console.error("Error hashing password during registration:", hashError);
            res.status(500).send("Server error during registration process.");
        }
    });
});

// POST Logout
app.post('/logout', (req, res) => {
    const username = req.session.user ? req.session.user.username : 'User';
    req.session.destroy((err) => {
        if (err) {
            console.error("Error destroying session:", err);
            return res.status(500).send("Could not log out.");
        }
        res.clearCookie('connect.sid'); // Match the default session cookie name used by express-session
        console.log(`${username} logged out.`);
        res.redirect('/login'); // Redirect to login page after logout
    });
});


// --- Socket.IO Real-Time Logic ---

io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Event: Client wants to join a specific board's room
    socket.on('joinBoard', async ({ boardId, nickname }) => {
        // Validate input
        if (typeof boardId !== 'number' || isNaN(boardId)) {
            console.warn(`Invalid boardId from ${socket.id}:`, boardId);
            return socket.emit('error', 'Invalid Board ID provided.');
        }

        // Sanitize nickname (basic)
        let userNickname = nickname && typeof nickname === 'string' && nickname.trim()
                           ? nickname.trim().substring(0, 30) // Limit length
                           : `Guest_${socket.id.substring(0, 4)}`; // Default guest name

        // Check if board exists before joining room (optional but good)
        db.get('SELECT id FROM boards WHERE id = ?', [boardId], (err, board) => {
             if (err || !board) {
                 console.warn(`Join attempt failed: Board ${boardId} not found for socket ${socket.id}.`);
                 return socket.emit('error', `Board with ID ${boardId} not found.`);
             }

             // Board exists, proceed with joining
             const roomName = `board-${boardId}`;

             // Leave previous board rooms if any (prevent multiple board contexts)
             Object.keys(socket.rooms).forEach(room => {
                if (room.startsWith('board-') && room !== socket.id) { // Don't leave the default socket.id room
                    socket.leave(room);
                    console.log(`Socket ${socket.id} left room ${room}`);
                }
             });


             // Store context on the socket object for later use in other events
             socket.boardId = boardId;
             socket.nickname = userNickname;

             // Join the Socket.IO room
             socket.join(roomName);
             console.log(`'${userNickname}' (Socket ${socket.id}) joined room: ${roomName}`);

             // --- Send initial tasks for *this specific board* ---
             const initialTasksSql = `
                 SELECT id, title, completed, assignedTo, createdAt
                 FROM tasks
                 WHERE boardId = ?
                 ORDER BY createdAt DESC
             `;
             db.all(initialTasksSql, [boardId], (tasksErr, tasks) => {
                 if (tasksErr) {
                     console.error(`Error fetching initial tasks for board ${boardId}:`, tasksErr.message);
                     socket.emit('error', 'Could not fetch tasks for this board.');
                 } else {
                     console.log(`Sending ${tasks.length} initial tasks for board ${boardId} to ${socket.id}`);
                     socket.emit('initialTasks', tasks || []); // Send tasks only to the client who just joined
                 }
             });

             // Optional: Notify others in the room that someone joined
             // socket.to(roomName).emit('userJoined', { nickname: userNickname });
        });
    });

    // --- Task Operations (Scoped to the board the socket is in) ---

    // Helper function to check if socket is in a valid board context
    function checkBoardContext(socket) {
        if (typeof socket.boardId !== 'number') {
            console.warn(`Action denied: Socket ${socket.id} (${socket.nickname || 'N/A'}) is not associated with a board.`);
            socket.emit('error', 'Action failed: Board context is missing. Please rejoin the board.');
            return null; // Indicate failure
        }
        return { boardId: socket.boardId, roomName: `board-${socket.boardId}` };
    }

     // Helper function to verify a task belongs to the socket's current board
     function verifyTaskBelongsToBoard(taskId, expectedBoardId, callback) {
        if (typeof taskId !== 'number') return callback(new Error('Invalid task ID format.'));

        db.get('SELECT boardId FROM tasks WHERE id = ?', [taskId], (err, task) => {
            if (err) {
                 console.error(`DB error finding task ${taskId} for verification:`, err.message);
                 return callback(new Error('Database error finding task.')); // Generic error
            }
            if (!task) {
                 return callback(new Error(`Task with ID ${taskId} not found.`));
            }
            if (task.boardId !== expectedBoardId) {
                console.warn(`Security Violation: Socket ${socket.id} (${socket.nickname}) in board ${expectedBoardId} tried to access task ${taskId} from board ${task.boardId}.`);
                // Don't reveal the task exists elsewhere for security
                return callback(new Error(`Task with ID ${taskId} not found on this board.`));
            }
            // Task found and belongs to the correct board
            callback(null, task); // Success, pass task data if needed (here just boardId)
        });
    }


    // Event: Create a new task on the current board
    socket.on('createTask', (taskData) => {
        const context = checkBoardContext(socket);
        if (!context) return; // Error already sent by checkBoardContext

        const title = taskData ? taskData.title : null;
        if (!title || typeof title !== 'string' || title.trim() === '' || title.trim().length > 255) {
            console.warn(`Invalid title from ${socket.id} on board ${context.boardId}:`, title);
            return socket.emit('error', 'Invalid task title (1-255 characters).');
        }
        const trimmedTitle = title.trim();

        console.log(`Received createTask on ${context.roomName}: "${trimmedTitle}" by ${socket.nickname}`);

        const insertSql = `INSERT INTO tasks (boardId, title, completed, assignedTo) VALUES (?, ?, ?, ?)`;
        const params = [context.boardId, trimmedTitle, false, null]; // New tasks are not assigned

        db.run(insertSql, params, function(err) {
            if (err) {
                console.error(`DB error inserting task "${trimmedTitle}" for board ${context.boardId}:`, err.message);
                return socket.emit('error', 'Failed to save task.');
            }
            const taskId = this.lastID;
            console.log(`Task "${trimmedTitle}" (Board ${context.boardId}) inserted ID: ${taskId}. Fetching full data.`);

            // Fetch the newly created task to broadcast to everyone on the board
             const fetchNewTaskSql = `SELECT id, title, completed, assignedTo, createdAt FROM tasks WHERE id = ?`;
            db.get(fetchNewTaskSql, [taskId], (fetchErr, newTask) => {
                if (fetchErr || !newTask) {
                    console.error(`Error fetching new task ${taskId} or not found:`, fetchErr?.message);
                    // Attempt to send fallback data if fetch fails
                     io.to(context.roomName).emit('taskCreated', {
                        id: taskId,
                        boardId: context.boardId,
                        title: trimmedTitle,
                        completed: false,
                        assignedTo: null,
                        createdAt: new Date().toISOString()
                    });
                    return;
                }
                 // Add boardId to the object being sent if client needs it (usually implied by room)
                 const taskToSend = { ...newTask, boardId: context.boardId };
                 console.log(`Broadcasting taskCreated to ${context.roomName}:`, taskToSend);
                 io.to(context.roomName).emit('taskCreated', taskToSend); // Broadcast to the board room
            });
        });
    });

    // Event: Toggle a task's completion status
    socket.on('toggleTask', (taskId) => {
        const context = checkBoardContext(socket);
        if (!context) return;

        console.log(`Received toggleTask in ${context.roomName} for task ID: ${taskId} by ${socket.nickname}`);

        verifyTaskBelongsToBoard(taskId, context.boardId, (verifyErr, task) => {
            if (verifyErr) return socket.emit('error', verifyErr.message);

            // Task verified, now get its current status and update
             db.get(`SELECT completed FROM tasks WHERE id = ?`, [taskId], (err, row) => {
                 if (err || !row) {
                     console.error(`DB error getting status for task ${taskId} or not found:`, err?.message);
                     return socket.emit('error', 'Failed to get task status.');
                 }

                const newCompletedStatus = !row.completed;
                db.run(`UPDATE tasks SET completed = ? WHERE id = ?`, [newCompletedStatus ? 1 : 0, taskId], function(updateErr) {
                    if (updateErr) {
                         console.error(`DB error updating task ${taskId} on board ${context.boardId}:`, updateErr.message);
                         return socket.emit('error', 'Failed to update task status.');
                     }
                    if (this.changes > 0) {
                        console.log(`Task ${taskId} (Board ${context.boardId}) toggled to ${newCompletedStatus}. Broadcasting taskUpdated to ${context.roomName}.`);
                        // Broadcast *only the changes* to the specific board room
                        io.to(context.roomName).emit('taskUpdated', { id: taskId, completed: newCompletedStatus });
                    } else {
                         console.warn(`Toggle task ${taskId} update had no effect (changes=0).`);
                    }
                });
            });
        });
    });

    // Event: Set or clear a task's assignment (using nickname)
    socket.on('setTaskAssignment', (data) => {
        const context = checkBoardContext(socket);
        if (!context) return;

        const taskId = data ? data.taskId : null;
        let assignment = data ? data.assignment : null; // This is the nickname or null

        // Basic validation on assignment value
        if (typeof assignment === 'string') {
            assignment = assignment.trim();
            if (assignment === '') assignment = null; // Treat empty string as unassigning
            assignment = assignment ? assignment.substring(0, 50) : null; // Limit length
        } else if (assignment !== null) {
             console.warn(`Invalid assignment type from ${socket.id}: ${typeof assignment}`);
             return socket.emit('error', 'Invalid assignment format provided.');
        }

        console.log(`Received setTaskAssignment in ${context.roomName} for task ID: ${taskId} to "${assignment}" by ${socket.nickname}`);

         verifyTaskBelongsToBoard(taskId, context.boardId, (verifyErr, task) => {
            if (verifyErr) return socket.emit('error', verifyErr.message);

            // Task verified, proceed with update
             const updateSql = `UPDATE tasks SET assignedTo = ? WHERE id = ?`;
             db.run(updateSql, [assignment, taskId], function(updateErr) {
                 if (updateErr) {
                     console.error(`DB error updating assignment for task ${taskId} on board ${context.boardId}:`, updateErr.message);
                     return socket.emit('error', 'Failed to update assignment.');
                 }
                 if (this.changes > 0) {
                     console.log(`Assignment for task ${taskId} (Board ${context.boardId}) updated to "${assignment}". Broadcasting taskUpdated to ${context.roomName}.`);
                     // Broadcast the assignment change to the room
                     io.to(context.roomName).emit('taskUpdated', { id: taskId, assignedTo: assignment });
                 } else {
                      console.warn(`Set assignment for task ${taskId} update had no effect (changes=0).`);
                 }
             });
         });
    });

    // Event: Delete a task
    socket.on('deleteTask', (taskId) => {
        const context = checkBoardContext(socket);
        if (!context) return;

        console.log(`Received deleteTask in ${context.roomName} for task ID: ${taskId} by ${socket.nickname}`);

         verifyTaskBelongsToBoard(taskId, context.boardId, (verifyErr, task) => {
             if (verifyErr) return socket.emit('error', verifyErr.message);

             // Task verified, proceed with deletion
             db.run(`DELETE FROM tasks WHERE id = ?`, [taskId], function(deleteErr) {
                 if (deleteErr) {
                     console.error(`DB error deleting task ${taskId} on board ${context.boardId}:`, deleteErr.message);
                     return socket.emit('error', 'Failed to delete task.');
                 }
                 if (this.changes > 0) {
                     console.log(`Task ${taskId} (Board ${context.boardId}) deleted. Broadcasting taskDeleted to ${context.roomName}.`);
                     // Broadcast the ID of the deleted task to the room
                     io.to(context.roomName).emit('taskDeleted', { id: taskId });
                 } else {
                      console.warn(`Delete task ${taskId} update had no effect (changes=0).`);
                 }
             });
         });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        const nickname = socket.nickname || `Socket ${socket.id}`;
        console.log(`Socket disconnected: ${nickname}`);
        // Socket.IO automatically handles leaving rooms on disconnect.
        // Optional: Notify others in the room that the user left
        // const context = checkBoardContext(socket); // Check if they were in a board context
        // if (context) {
        //    io.to(context.roomName).emit('userLeft', { nickname: nickname });
        // }
    });
}); // End io.on('connection')

// --- Start Server ---
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('Ensure you have deleted old tasks.db and sessions.db if restarting with schema changes.');
    console.warn('IMPORTANT: Remember to change the default session secret in server.js!');
});