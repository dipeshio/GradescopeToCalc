// Debug script to test in browser console on Gradescope page
// Paste this in the browser console when on a Gradescope course page

console.log('=== DEBUGGING GRADESCOPE SYNC ===');

// Test the content script parsing
function debugParser() {
  console.log('1. Testing course name extraction...');
  const courseHeader = document.querySelector('.courseHeader--title');
  if (courseHeader) {
    const fullTitle = courseHeader.textContent.trim();
    const match = fullTitle.match(/^([A-Z]+ \d+)/);
    const courseName = match ? match[1] : fullTitle;
    console.log('✓ Course name:', courseName);
  } else {
    console.log('✗ Course header not found');
  }

  console.log('2. Testing assignment parsing...');
  const rows = document.querySelectorAll('#assignments-student-table tbody tr[role="row"]');
  console.log(`Found ${rows.length} assignment rows`);

  const assignments = [];
  rows.forEach((row, index) => {
    const assignmentButton = row.querySelector('.js-submitAssignment');
    if (!assignmentButton) {
      console.log(`Row ${index}: No assignment button found`);
      return;
    }

    const assignmentTitle = assignmentButton.getAttribute('data-assignment-title');
    const assignmentId = assignmentButton.getAttribute('data-assignment-id');
    
    const statusElement = row.querySelector('.submissionStatus--text');
    const status = statusElement ? statusElement.textContent.trim() : 'Unknown';
    
    let statusAbbr = 'IP';
    if (status.toLowerCase().includes('submitted') || status.toLowerCase().includes('complete')) {
      statusAbbr = 'SUBMITTED';
    }

    const dueDateElement = row.querySelector('.submissionTimeChart--dueDate');
    let dueDate = null;
    if (dueDateElement) {
      const dateTimeAttr = dueDateElement.getAttribute('datetime');
      if (dateTimeAttr) {
        dueDate = new Date(dateTimeAttr);
      }
    }

    const assignment = {
      id: assignmentId,
      title: assignmentTitle,
      status: status,
      statusAbbr: statusAbbr,
      dueDate: dueDate,
      courseName: courseHeader ? courseHeader.textContent.trim().match(/^([A-Z]+ \d+)/)?.[1] : 'Unknown',
      fullTitle: `${courseHeader ? courseHeader.textContent.trim().match(/^([A-Z]+ \d+)/)?.[1] : 'Unknown'}: ${assignmentTitle} (${statusAbbr})`
    };

    assignments.push(assignment);
    console.log(`Assignment ${index + 1}:`, assignment);
  });

  return assignments;
}

// Test the parsing
const parsedAssignments = debugParser();

console.log('3. Testing Google Tasks API call simulation...');
if (parsedAssignments.length > 0) {
  const testAssignment = parsedAssignments[0];
  console.log('Test assignment for API call:', testAssignment);
  
  // Simulate the task object building
  const title = testAssignment.fullTitle;
  const notes = `Assignment from ${testAssignment.courseName}\n\nStatus: ${testAssignment.status}\n\nSynced from Gradescope`;
  
  let due = null;
  if (testAssignment.dueDate) {
    const dueDate = new Date(testAssignment.dueDate);
    if (!isNaN(dueDate.getTime())) {
      due = dueDate.toISOString();
    } else {
      console.warn('Invalid due date:', testAssignment.dueDate);
    }
  }

  const taskObject = {
    title: title,
    notes: notes,
    status: testAssignment.statusAbbr === 'SUBMITTED' ? 'completed' : 'needsAction'
  };

  if (due) {
    taskObject.due = due;
  }

  console.log('Generated task object:', taskObject);
  console.log('Task object JSON:', JSON.stringify(taskObject, null, 2));
}

console.log('=== DEBUG COMPLETE ===');
