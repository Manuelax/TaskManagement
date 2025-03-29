// public/dashboard-script.js

document.addEventListener('DOMContentLoaded', () => {
    const boardList = document.getElementById('board-list');
    const createBoardForm = document.getElementById('create-board-form');
    const newBoardNameInput = document.getElementById('new-board-name');
    const fetchBoardsErrorDiv = document.getElementById('fetch-boards-error');
    const createBoardErrorDiv = document.getElementById('create-board-error');

    // Function to display error messages
    function showError(element, message) {
        element.textContent = message;
        element.style.display = 'block'; // Make error message visible
    }

    // Function to hide error messages
    function hideError(element) {
        element.textContent = '';
        element.style.display = 'none'; // Hide error message element
    }

    // Function to fetch and display boards
    function fetchAndDisplayBoards() {
        hideError(fetchBoardsErrorDiv); // Hide any previous fetch errors
        boardList.innerHTML = '<li class="loading">Loading your boards...</li>'; // Show loading state

        fetch('/api/boards') // Calls the API endpoint defined in server.js
            .then(response => {
                if (!response.ok) {
                    // If response is 401 (Unauthorized), likely session expired or not logged in
                    if (response.status === 401) {
                         window.location.href = '/login'; // Redirect to login page
                         // Throw an error to stop further processing in this .then chain
                         throw new Error('Authentication required. Redirecting to login...');
                    }
                    // For other errors, throw a generic HTTP error
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                // If response is OK, parse the JSON body
                return response.json();
            })
            .then(boards => {
                boardList.innerHTML = ''; // Clear loading/previous boards
                if (!boards || boards.length === 0) {
                    // Display message if no boards are found
                    boardList.innerHTML = '<li class="no-boards">You haven\'t created any boards yet.</li>';
                } else {
                    // Loop through the received boards array
                    boards.forEach(board => {
                        const li = document.createElement('li');
                        // Add class for specific styling from the new CSS
                        li.className = 'board-list-item';

                        // Create the link for the board name
                        const nameLink = document.createElement('a');
                        nameLink.href = `/board/${board.id}`; // Link to the specific board page
                        nameLink.textContent = board.name;
                        nameLink.title = `Go to board: ${board.name}`;
                        nameLink.className = 'board-name-link'; // Apply specific class for styling

                        // Create the "View Board" button link
                        const viewButton = document.createElement('a');
                        viewButton.href = `/board/${board.id}`;
                        viewButton.textContent = 'View Board';
                        // Apply general button style and specific view-board link style
                        viewButton.className = 'button view-board-link';

                        // Append the name link and view button to the list item
                        li.appendChild(nameLink);
                        li.appendChild(viewButton);
                        // Append the list item to the board list (UL element)
                        boardList.appendChild(li);
                    });
                }
            })
            .catch(error => {
                // Handle any errors during the fetch process
                console.error('Error fetching boards:', error);
                 // Display specific message for auth errors before potential redirect
                 if (error.message.includes('Authentication required')) {
                    showError(fetchBoardsErrorDiv, error.message);
                 } else {
                    // Display a generic error message for other issues
                    showError(fetchBoardsErrorDiv, 'Could not load your boards. Please try refreshing the page.');
                 }
                 // Clear the loading message from the list on error
                 boardList.innerHTML = '';
            });
    }

    // Event listener for the create board form submission
    createBoardForm.addEventListener('submit', (event) => {
        event.preventDefault(); // Prevent the default form submission behavior
        hideError(createBoardErrorDiv); // Hide any previous creation errors

        const boardName = newBoardNameInput.value.trim(); // Get and trim the board name input
        if (!boardName) {
            // Show error if the board name is empty
            showError(createBoardErrorDiv, 'Board name cannot be empty.');
            return; // Stop the function if validation fails
        }

        // Send POST request to the API to create a new board
        fetch('/api/boards', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', // Indicate we're sending JSON data
            },
            // Convert the board name into a JSON string
            body: JSON.stringify({ boardName: boardName }),
        })
        .then(response => {
             // Check for authentication error first
             if (response.status === 401) {
                window.location.href = '/login'; // Redirect if not authenticated
                throw new Error('Authentication required.');
             }
             // Check if the response status is not OK (e.g., 400, 500)
             if (!response.ok) {
                 // Try to parse error message from server's JSON response, if available
                 return response.json().then(errData => {
                     // Throw error with server message or generic message
                     throw new Error(errData.error || `Failed to create board. Status: ${response.status}`);
                 }).catch(() => {
                    // If parsing JSON fails, throw generic error
                    throw new Error(`Failed to create board. Status: ${response.status}`);
                 });
             }
             // If response is OK, parse the successful JSON response (expecting { id, name })
             return response.json();
        })
        .then(newBoard => {
            // Handle successful board creation
            console.log('Board created:', newBoard);
            newBoardNameInput.value = ''; // Clear the input field
            fetchAndDisplayBoards(); // Refresh the board list to show the new board
        })
        .catch(error => {
            // Handle any errors during the board creation process
            console.error('Error creating board:', error);
            // Display the error message to the user
            showError(createBoardErrorDiv, `Error: ${error.message}`);
        });
    });

    // Initial fetch of boards when the dashboard page loads
    fetchAndDisplayBoards();

    console.log('Dashboard script loaded and initialized.');
});