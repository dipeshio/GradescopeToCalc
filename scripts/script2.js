// Function that extracts assignment names and due dates from Gradescope
function parseInfo() {
  try {
    const assignments = document.querySelectorAll('.js-submitAssignment');
    const assignmentArray = [];
    
    if (assignments.length === 0) {
      console.log("No assignments found. Make sure you're on a Gradescope course page.");
      return [];
    }
    
    assignments.forEach(assignment => {
      try {
        const title = assignment.getAttribute('data-assignment-title');
        const dueDateElement = assignment.querySelector('.submissionTimeChart--dueDate');
        let dueDate = dueDateElement ? dueDateElement.innerText.trim() : 'No due date found';
        
        // Convert date string to Date object for comparison
        let dueDateTime = null;
        if (dueDate && dueDate !== 'No due date found') {
          // Extract date from common Gradescope formats
          // Format example: "Due: Feb 29 at 11:59pm PST"
          const dateMatch = dueDate.match(/Due: ([A-Za-z]+ \d+) at (\d+:\d+[ap]m)/i);
          if (dateMatch) {
            const dateStr = dateMatch[1];
            const timeStr = dateMatch[2];
            const year = new Date().getFullYear(); // Assume current year
            dueDateTime = new Date(`${dateStr}, ${year} ${timeStr}`);
            
            // Add proper formatting for display
            const options = { 
              weekday: 'short', 
              month: 'short', 
              day: 'numeric', 
              hour: 'numeric', 
              minute: 'numeric',
              hour12: true
            };
            dueDate = dueDateTime.toLocaleDateString('en-US', options);
          }
        }
        
        assignmentArray.push({ 
          title, 
          dueDate, 
          dueDateTime,
          isUpcoming: dueDateTime && dueDateTime > new Date()
        });
      } catch (err) {
        console.error('Error parsing assignment:', err);
      }
    });
    
    // Sort by date (upcoming first)
    assignmentArray.sort((a, b) => {
      if (!a.dueDateTime) return 1;
      if (!b.dueDateTime) return -1;
      return a.dueDateTime - b.dueDateTime;
    });
    
    console.log('Found assignments:', assignmentArray);
    
    // Store in Chrome storage
    if (chrome && chrome.storage) {
      chrome.storage.local.set({ gradescopeAssignments: assignmentArray }, function() {
        console.log('Assignments saved to storage');
      });
    }
    
    return assignmentArray;
  } catch (error) {
    console.error('Error in parseInfo:', error);
    return [];
  }
}

// Function to get all assignments and filter upcoming ones
function getUpcomingAssignments() {
  const assignments = parseInfo();
  return assignments.filter(a => a.isUpcoming);
}

// This runs when the content script loads
// We make the functions available to the popup
window.parseInfo = parseInfo;
window.getUpcomingAssignments = getUpcomingAssignments;