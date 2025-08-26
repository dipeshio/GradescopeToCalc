// Test parser to debug Gradescope assignment parsing
// Run this in browser console on the test HTML file

function testParser() {
  console.log('=== TESTING GRADESCOPE PARSER ===');
  
  // Test course name extraction
  const courseHeader = document.querySelector('.courseHeader--title');
  if (courseHeader) {
    const fullTitle = courseHeader.textContent.trim();
    const match = fullTitle.match(/^([A-Z]+ \d+)/);
    const courseName = match ? match[1] : fullTitle;
    console.log('Course name:', courseName);
  } else {
    console.log('Course header not found');
  }
  
  // Test assignment parsing
  const rows = document.querySelectorAll('#assignments-student-table tbody tr[role="row"]');
  console.log('Found', rows.length, 'assignment rows');
  
  rows.forEach((row, index) => {
    console.log(`\n=== Assignment ${index + 1} ===`);
    
    // Get assignment button
    const assignmentButton = row.querySelector('.js-submitAssignment');
    if (assignmentButton) {
      const assignmentTitle = assignmentButton.getAttribute('data-assignment-title');
      const assignmentId = assignmentButton.getAttribute('data-assignment-id');
      console.log('Title:', assignmentTitle);
      console.log('ID:', assignmentId);
    } else {
      console.log('Assignment button not found');
    }
    
    // Get submission status
    const statusElement = row.querySelector('.submissionStatus--text');
    if (statusElement) {
      const status = statusElement.textContent.trim();
      console.log('Status:', status);
    } else {
      console.log('Status element not found');
    }
    
    // Get due date
    const dueDateElement = row.querySelector('.submissionTimeChart--dueDate');
    if (dueDateElement) {
      const dateTimeAttr = dueDateElement.getAttribute('datetime');
      const dateText = dueDateElement.textContent.trim();
      console.log('Due date attr:', dateTimeAttr);
      console.log('Due date text:', dateText);
      
      if (dateTimeAttr) {
        const dueDate = new Date(dateTimeAttr);
        console.log('Parsed date:', dueDate);
        console.log('ISO string:', dueDate.toISOString());
      }
    } else {
      console.log('Due date element not found');
    }
  });
}

// Run the test
testParser();