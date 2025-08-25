// Test script to verify assignment parsing logic
// This can be run in browser console on the test HTML files

// Simulate the GradescopeParser class for testing
class TestGradescopeParser {
  constructor() {
    this.assignments = [];
    this.courseName = '';
  }

  extractCourseName() {
    const courseHeader = document.querySelector('.courseHeader--title');
    if (courseHeader) {
      const fullTitle = courseHeader.textContent.trim();
      // Extract just the course code (e.g., "MATH 303" from "MATH 303: 02 (12pm)")
      const match = fullTitle.match(/^([A-Z]+ \d+)/);
      this.courseName = match ? match[1] : fullTitle;
    }
    return this.courseName;
  }

  parseAssignments() {
    const assignments = [];
    const rows = document.querySelectorAll('#assignments-student-table tbody tr[role="row"]');
    
    console.log(`Found ${rows.length} assignment rows`);
    
    rows.forEach((row, index) => {
      const assignment = this.parseAssignmentRow(row);
      if (assignment) {
        assignments.push(assignment);
        console.log(`Assignment ${index + 1}:`, assignment);
      }
    });

    this.assignments = assignments;
    return assignments;
  }

  parseAssignmentRow(row) {
    try {
      // Get assignment name from data-assignment-title attribute
      const assignmentButton = row.querySelector('.js-submitAssignment');
      if (!assignmentButton) return null;

      const assignmentTitle = assignmentButton.getAttribute('data-assignment-title');
      if (!assignmentTitle) return null;

      // Get submission status
      const statusElement = row.querySelector('.submissionStatus--text');
      const status = statusElement ? statusElement.textContent.trim() : 'Unknown';
      
      // Determine status abbreviation
      let statusAbbr = 'IP'; // In Progress
      if (status.toLowerCase().includes('submitted') || status.toLowerCase().includes('complete')) {
        statusAbbr = 'SUBMITTED';
      } else if (status.toLowerCase().includes('no submission')) {
        statusAbbr = 'IP';
      }

      // Get due date
      const dueDateElement = row.querySelector('.submissionTimeChart--dueDate');
      let dueDate = null;
      if (dueDateElement) {
        const dateTimeAttr = dueDateElement.getAttribute('datetime');
        if (dateTimeAttr) {
          dueDate = new Date(dateTimeAttr);
        }
      }

      // Get assignment ID for tracking
      const assignmentId = assignmentButton.getAttribute('data-assignment-id');

      return {
        id: assignmentId,
        title: assignmentTitle,
        status: status,
        statusAbbr: statusAbbr,
        dueDate: dueDate,
        courseName: this.courseName,
        fullTitle: `${this.courseName}: ${assignmentTitle} (${statusAbbr})`
      };
    } catch (error) {
      console.error('Error parsing assignment row:', error);
      return null;
    }
  }

  getAllData() {
    this.extractCourseName();
    this.parseAssignments();
    
    return {
      courseName: this.courseName,
      assignments: this.assignments
    };
  }
}

// Test function to run the parser
function testParser() {
  console.log('Testing Gradescope Assignment Parser...');
  
  const parser = new TestGradescopeParser();
  const data = parser.getAllData();
  
  console.log('=== PARSING RESULTS ===');
  console.log('Course Name:', data.courseName);
  console.log('Number of Assignments:', data.assignments.length);
  
  data.assignments.forEach((assignment, index) => {
    console.log(`\n--- Assignment ${index + 1} ---`);
    console.log('ID:', assignment.id);
    console.log('Title:', assignment.title);
    console.log('Status:', assignment.status);
    console.log('Status Abbr:', assignment.statusAbbr);
    console.log('Due Date:', assignment.dueDate);
    console.log('Full Title:', assignment.fullTitle);
    console.log('Due Date String:', assignment.dueDate ? assignment.dueDate.toLocaleString() : 'No due date');
  });
  
  console.log('\n=== CALENDAR FORMAT PREVIEW ===');
  data.assignments.forEach((assignment, index) => {
    if (assignment.dueDate) {
      console.log(`${index + 1}. ${assignment.fullTitle}`);
      console.log(`   Due: ${assignment.dueDate.toLocaleString()}`);
      console.log(`   Calendar Event: 1 hour ending at ${assignment.dueDate.toLocaleString()}`);
    }
  });
  
  return data;
}

// Run the test
console.log('To test the parser, run: testParser()');
