// public/board-script.js

document.addEventListener('DOMContentLoaded', () => {
    console.log('Board script initializing...');
    const socket = io(); // Connect to Socket.IO server

    // --- Get Board ID and Elements ---
    const pathSegments = window.location.pathname.split('/');
    const boardId = parseInt(pathSegments[pathSegments.length - 1], 10); // Get board ID from URL

    const taskList = document.getElementById('task-list');
    const taskTitleInput = document.getElementById('task-title');
    const addTaskBtn = document.getElementById('add-task-btn');
    const boardNameElement = document.getElementById('board-name');
    const currentUserInfoElement = document.getElementById('current-user-info'); // Get the new paragraph element

    if (isNaN(boardId)) {
        showErrorState('Invalid Board URL. Cannot load board.');
        console.error("Invalid Board ID parsed from URL:", window.location.pathname);
        // Disable input if board ID is invalid
        if(taskTitleInput) taskTitleInput.disabled = true;
        if(addTaskBtn) addTaskBtn.disabled = true;
        if(currentUserInfoElement) currentUserInfoElement.textContent = 'Error: Invalid Board'; // Update status
        return; // Stop execution if board ID is bad
    }

    // Try to get a nickname stored for this specific board in this browser session
    let userNickname = sessionStorage.getItem(`board-${boardId}-nickname`);

    // --- Initial Setup ---

    // 1. Fetch Board Details (Name) via API
    fetch(`/api/board/${boardId}/details`)
        .then(res => {
            if (!res.ok) {
                if (res.status === 404) throw new Error('Board not found (404).');
                throw new Error(`HTTP error fetching board details! Status: ${res.status}`);
            }
            return res.json();
        })
        .then(boardDetails => {
            boardNameElement.textContent = `${boardDetails.name}`; // Simpler title
            document.title = `${boardDetails.name} - Task Board`; // Update page title

            // 2. After confirming board exists, ask for nickname if needed and join the Socket.IO room
            joinBoardRoom();
        })
        .catch(error => {
            console.error("Error fetching board details:", error);
            showErrorState(`Error loading board: ${error.message}. Please check the URL or go back.`);
            boardNameElement.textContent = 'Error Loading Board';
            if(currentUserInfoElement) currentUserInfoElement.textContent = 'Error loading board';
             // Disable input on error
             if(taskTitleInput) taskTitleInput.disabled = true;
             if(addTaskBtn) addTaskBtn.disabled = true;
        });


    // Function to handle joining the Socket.IO room for this board
    function joinBoardRoom() {
        if (!userNickname) {
            // Prompt for nickname only if it's not already stored in sessionStorage
             userNickname = prompt("Enter your nickname for this board session:", `Guest_${Math.random().toString(36).substring(2, 6)}`);
             // Basic validation and fallback for prompt
             if (!userNickname || !userNickname.trim()) {
                 userNickname = `Guest_${socket.id.substring(0,4)}`; // Use part of socket ID if prompt fails
             } else {
                 userNickname = userNickname.trim().substring(0, 30); // Trim and limit length
             }
             // Store the chosen nickname in sessionStorage for this board
             sessionStorage.setItem(`board-${boardId}-nickname`, userNickname);
        }

        // Display the nickname in the designated paragraph
        if (currentUserInfoElement) {
            currentUserInfoElement.textContent = `Connected as: ${userNickname}`;
        }

        console.log(`Attempting to join board ${boardId} as '${userNickname}'`);
        // Emit the 'joinBoard' event to the server
        socket.emit('joinBoard', { boardId: boardId, nickname: userNickname });
        // Server will respond with 'initialTasks' or 'error'
    }


    // --- Helper Functions ---

    // Function to render a single task item in the list
    function renderTask(task) {
        // Task object expected: { id, title, completed, assignedTo, createdAt }
        console.log('Rendering task:', task.id, task.title, `(Completed: ${task.completed}, Assigned: ${task.assignedTo})`);

        // Avoid duplicates - check if LI already exists
        const existingLi = taskList.querySelector(`li[data-task-id="${task.id}"]`);
        if (existingLi) {
            console.warn(`Task ${task.id} already exists. Updating instead of re-rendering.`);
            // Update existing task item instead of adding a new one
            updateTaskInUI({
                id: task.id,
                title: task.title, // Allow title updates if needed later
                completed: task.completed,
                assignedTo: task.assignedTo
            }, existingLi);
            return; // Stop here, don't append a duplicate
        }


        const li = document.createElement('li');
        li.dataset.taskId = task.id;
        li.className = task.completed ? 'completed' : ''; // Add 'completed' class if task is done

        // Task Text (Title)
        const taskText = document.createElement('span');
        taskText.className = 'task-text';
        taskText.textContent = task.title;

        // Assignment Display Span
        const assignmentSpan = document.createElement('span');
        assignmentSpan.className = 'assignment-display';
        assignmentSpan.dataset.taskIdForAssignment = task.id; // Link to task ID

        // "Edit" button for assignment
        const editBtn = document.createElement('button');
        editBtn.className = 'button link-style edit-assignment-btn'; // Use new button style class
        editBtn.textContent = '[Edit]';
        editBtn.title = 'Edit assignment';
        editBtn.type = 'button';
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
             const currentAssignmentText = assignmentSpan.dataset.currentAssignment || null;
            promptForAssignment(task.id, currentAssignmentText);
        });

        // Set initial text content for assignment span (includes the edit button)
        setAssignmentText(assignmentSpan, task.assignedTo, editBtn);

        // Div for controls (checkbox, delete button)
        const controlsDiv = document.createElement('div');
        controlsDiv.className = 'task-controls';

        // Checkbox
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = task.completed;
        checkbox.title = "Mark complete/incomplete";
        checkbox.addEventListener('change', () => {
            console.log(`Checkbox changed for task ${task.id}. Emitting toggleTask.`);
            socket.emit('toggleTask', task.id);
        });

        // Delete Button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.title = "Delete task";
        deleteBtn.type = 'button';
        const deleteText = document.createElement('span');
        deleteText.textContent = 'Delete'; // Hidden text for accessibility
        deleteBtn.appendChild(deleteText);
        // Add the '✕' symbol via CSS ::before pseudo-element
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`Are you sure you want to delete task: "${task.title}"?`)) {
                console.log(`Confirmed delete for task ${task.id}. Emitting deleteTask.`);
                socket.emit('deleteTask', task.id);
            }
        });

        // Assemble the card content (order matters for flex column)
        li.appendChild(taskText);
        li.appendChild(assignmentSpan);
        controlsDiv.appendChild(checkbox);
        controlsDiv.appendChild(deleteBtn);
        li.appendChild(controlsDiv); // Add controls container last

        // Add the new task card to the list
        const placeholder = taskList.querySelector('.loading, .no-tasks, .error-message');
        if (placeholder) {
            taskList.innerHTML = ''; // Remove placeholder message
            taskList.appendChild(li);
        } else {
            // Add new tasks maybe based on date or just prepend/append
            // Prepending for now (newest appear first visually if grid wraps)
            taskList.insertBefore(li, taskList.firstChild);
        }
    }

    // Helper to set the text/button inside the assignment span and store current value
    function setAssignmentText(spanElement, assignment, editButton) {
        spanElement.innerHTML = ''; // Clear previous content
        const text = assignment ? `Assigned to: ${assignment} ` : 'Unassigned '; // Adjusted text
        const textNode = document.createTextNode(text);
        spanElement.appendChild(textNode);
        spanElement.appendChild(editButton); // Append the button after the text
        spanElement.dataset.currentAssignment = assignment || '';
    }


    // Function to prompt user for assignment nickname and emit event
    function promptForAssignment(taskId, currentAssignment) {
        const newAssignmentNickname = prompt(
            `Assign task to (enter nickname, leave blank to unassign):`,
            currentAssignment || "" // Pre-fill with current assignment if exists
        );

        // Check if the user pressed Cancel (null) vs entered an empty string
        if (newAssignmentNickname !== null) {
            const finalAssignment = newAssignmentNickname.trim() === '' ? null : newAssignmentNickname.trim().substring(0, 50); // Treat empty as null, limit length

            console.log(`Emitting setTaskAssignment for Task ID ${taskId} with assignment: "${finalAssignment}"`);
            socket.emit('setTaskAssignment', {
                taskId: taskId,
                assignment: finalAssignment // Send the nickname or null
            });
        } else {
             console.log("Assignment edit cancelled by user.");
        }
    }


    // Function to update an existing task's UI based on server events ('taskUpdated')
    function updateTaskInUI(updateData, taskItem = null) {
        // updateData can contain {id, completed} or {id, assignedTo} or both
        console.log(`Updating UI for task ${updateData.id}`, updateData);

        // Find the list item if not provided
        const li = taskItem || taskList.querySelector(`li[data-task-id="${updateData.id}"]`);
        if (!li) {
            console.warn(`Task item ${updateData.id} not found in UI for update.`);
            return; // Task not visible? Nothing to update.
        }

        // Update completion status (class and checkbox)
        if (typeof updateData.completed === 'boolean') {
             li.classList.toggle('completed', updateData.completed);
             const checkbox = li.querySelector('input[type="checkbox"]');
             if (checkbox) checkbox.checked = updateData.completed;
        }

        // Update Assignment Display if 'assignedTo' field is present in the update data
        if (updateData.assignedTo !== undefined) { // Check specifically for the key's presence
             const assignmentSpan = li.querySelector('.assignment-display');
             const editBtn = assignmentSpan ? assignmentSpan.querySelector('.edit-assignment-btn') : null;

             if (assignmentSpan && editBtn) {
                 setAssignmentText(assignmentSpan, updateData.assignedTo, editBtn); // Use helper to update text and button
             } else {
                 console.warn(`Assignment span or edit button not found for task ${updateData.id} during UI update.`);
             }
        }

         // Optional: Update task title text if provided
         if (typeof updateData.title === 'string') {
            const taskTextElement = li.querySelector('.task-text');
            if (taskTextElement) {
                taskTextElement.textContent = updateData.title;
            }
         }
    }

    // Function to remove a task from the UI ('taskDeleted')
    function removeTaskFromUI(taskId) {
        console.log(`Removing task ${taskId} from UI.`);
        const taskItem = taskList.querySelector(`li[data-task-id="${taskId}"]`);
        if (taskItem) {
            taskItem.remove();
            // Check if the list is now empty and show the 'no tasks' message
            if (taskList.children.length === 0 && !taskList.querySelector('.no-tasks')) {
                showNoTasksMessage();
            }
        } else {
            console.warn(`Task item ${taskId} not found for removal from UI.`);
        }
    }

    // Function to display "No tasks yet" message
    function showNoTasksMessage() {
        // Only add the message if the list is truly empty and message isn't already there
         if (taskList.children.length === 0 && !taskList.querySelector('.no-tasks')) {
            taskList.innerHTML = '<li class="no-tasks">No tasks on this board yet. Add one above!</li>';
        }
    }

    // Function to display a generic error state in the task list area
    function showErrorState(message) {
        // Display error within the task list container
        taskList.innerHTML = `<li class="error-message">${message}</li>`;
        console.error("Error State:", message);
         // Optionally disable input
         if(taskTitleInput) taskTitleInput.disabled = true;
         if(addTaskBtn) addTaskBtn.disabled = true;
    }

    // --- Socket Event Listeners ---

    socket.on('connect', () => {
        console.log('Socket connected to server:', socket.id);
        // If we got disconnected, we might need to rejoin the board
        if (typeof boardId === 'number' && !isNaN(boardId)) {
            console.log('Reconnected. Attempting to rejoin board room...');
            joinBoardRoom(); // Re-emit joinBoard on reconnection
        }
    });

    socket.on('disconnect', (reason) => {
        console.warn('Socket disconnected:', reason);
        showErrorState('Disconnected from server. Attempting to reconnect...');
        if (currentUserInfoElement) currentUserInfoElement.textContent = 'Disconnected';
    });

    socket.on('connect_error', (err) => {
        console.error('Socket Connection Error:', err.message);
        showErrorState(`Connection failed: ${err.message}. Please check your network or refresh.`);
        if (currentUserInfoElement) currentUserInfoElement.textContent = 'Connection Error';
    });

    // Listen for the initial list of tasks for this board
    socket.on('initialTasks', (tasks) => {
        console.log(`Received ${tasks.length} initial tasks for board ${boardId}:`, tasks);
        taskList.innerHTML = ''; // Clear loading/previous state
        if (!tasks || tasks.length === 0) {
            showNoTasksMessage();
        } else {
            // Render tasks, maybe sort them if needed (e.g., by creation date)
             tasks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); // Sort newest first
            tasks.forEach(renderTask);
        }
    });

    // Listen for a new task being created by anyone on this board
    socket.on('taskCreated', (newTask) => {
        console.log('Received taskCreated event:', newTask);
        renderTask(newTask);
    });

    // Listen for updates to a task (completion status or assignment)
    socket.on('taskUpdated', (updatedTaskData) => {
        console.log('Received taskUpdated event:', updatedTaskData);
        updateTaskInUI(updatedTaskData);
    });

    // Listen for a task being deleted by anyone on this board
    socket.on('taskDeleted', (deletedTaskData) => {
        console.log('Received taskDeleted event:', deletedTaskData);
        removeTaskFromUI(deletedTaskData.id);
    });

    // Listen for general errors sent from the server
    socket.on('error', (errorMessage) => {
        console.error('Server Error Received:', errorMessage);
        // Display error more prominently to the user if desired
        // Alert for now, but a non-blocking notification would be better UX
        alert(`Server Error: ${errorMessage}`);
        if (errorMessage.includes("Board context is missing")) {
             showErrorState("Lost connection context. Please refresh the page to rejoin the board.");
             if (currentUserInfoElement) currentUserInfoElement.textContent = 'Error: Rejoin required';
        } else if (errorMessage.includes("Board not found")) {
             showErrorState("Error: Board not found. Please check the URL.");
              if (currentUserInfoElement) currentUserInfoElement.textContent = 'Error: Board not found';
        }
    });


    // --- User Interface Event Listeners ---

    // Handle adding a new task
    function handleAddTask() {
        const title = taskTitleInput.value.trim();
        if (title) {
            console.log(`User submitting new task: title="${title}" for board ${boardId}`);
            socket.emit('createTask', { title: title });
            taskTitleInput.value = '';
            taskTitleInput.focus();
        } else {
            alert('Please enter a task title.');
            taskTitleInput.focus();
        }
    }

    // Add task when button is clicked
    addTaskBtn.addEventListener('click', handleAddTask);

    // Add task when Enter key is pressed in the input field
    taskTitleInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            handleAddTask();
        }
    });

    console.log('Board script fully initialized and listeners attached.');

}); // End DOMContentLoaded