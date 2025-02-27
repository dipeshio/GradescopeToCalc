document.addEventListener('DOMContentLoaded', function() {
  const syncButton = document.getElementById('syncButton');
  const statusDiv = document.getElementById('status');
  const assignmentListDiv = document.getElementById('assignmentList');
  
  // Check if we have stored assignments and display them
  chrome.storage.local.get(['gradescopeAssignments'], function(result) {
    if (result.gradescopeAssignments && result.gradescopeAssignments.length > 0) {
      displayAssignments(result.gradescopeAssignments);
    }
  });

  syncButton.addEventListener('click', async () => {
    statusDiv.textContent = 'Syncing assignments...';
    assignmentListDiv.innerHTML = '';
    
    try {
      // Get the active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // Check if we're on Gradescope
      if (!tab.url.includes('gradescope.com')) {
        statusDiv.textContent = 'Please navigate to Gradescope first';
        return;
      }
      
      // Execute script on the current tab and get the results
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['./scripts/script.js']
      });
      
      // Now execute a function to get the assignments
      const assignmentResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          // This calls the function we made available on the window object
          return window.getUpcomingAssignments ? 
                 window.getUpcomingAssignments() : 
                 [];
        }
      });
      
      // The results come back as an array from each frame
      const assignments = assignmentResults[0].result;
      
      if (!assignments || assignments.length === 0) {
        statusDiv.textContent = 'No upcoming assignments found';
        return;
      }
      
      // Display assignments
      displayAssignments(assignments);
      statusDiv.textContent = `Found ${assignments.length} upcoming assignments`;
      
    } catch (error) {
      statusDiv.textContent = 'Error: ' + error.message;
      console.error(error);
    }
  });
  
  // Function to display assignments in the popup
  function displayAssignments(assignments) {
    assignmentListDiv.innerHTML = '';
    
    if (!assignments || assignments.length === 0) {
      assignmentListDiv.innerHTML = '<p>No upcoming assignments found.</p>';
      return;
    }
    
    // Create a list for the assignments
    const list = document.createElement('ul');
    list.className = 'assignment-list';
    
    // Add each assignment to the list
    assignments.forEach(assignment => {
      const listItem = document.createElement('li');
      listItem.className = 'assignment-item';
      
      // Create a container for the assignment details
      const detailsContainer = document.createElement('div');
      detailsContainer.className = 'assignment-details';
      
      // Create and add the title
      const title = document.createElement('div');
      title.className = 'assignment-title';
      title.textContent = assignment.title || 'Untitled Assignment';
      detailsContainer.appendChild(title);
      
      // Create and add the due date
      const dueDate = document.createElement('div');
      dueDate.className = 'assignment-due-date';
      dueDate.textContent = assignment.dueDate || 'No due date';
      detailsContainer.appendChild(dueDate);
      
      // Add the details container to the list item
      listItem.appendChild(detailsContainer);
      
      // Add the list item to the list
      list.appendChild(listItem);
    });
    
    // Add the list to the assignment list div
    assignmentListDiv.appendChild(list);
  }
});