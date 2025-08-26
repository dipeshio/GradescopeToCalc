// Debug script for Google Tasks API - paste in browser console

console.log('=== GOOGLE TASKS API DEBUG ===');

// Function to test task creation
async function testTaskCreation() {
  console.log('Testing task creation...');
  
  // Get the access token from extension storage
  chrome.storage.local.get(['googleAccessToken'], async (result) => {
    if (!result.googleAccessToken) {
      console.error('No access token found. Please authenticate first.');
      return;
    }

    const accessToken = result.googleAccessToken;
    console.log('Using access token:', accessToken.substring(0, 20) + '...');

    // Test task object
    const testTask = {
      title: "Test Task from Debug Script",
      notes: "This is a test task\n\n⏰ Due Time: 5:00 PM",
      status: "needsAction",
      due: "2025-08-27"
    };

    console.log('Test task object:', JSON.stringify(testTask, null, 2));

    try {
      // Test creating a task
      console.log('Making API request to create task...');
      const response = await fetch('https://www.googleapis.com/tasks/v1/lists/@default/tasks', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(testTask)
      });

      console.log('Response status:', response.status);
      console.log('Response headers:', Object.fromEntries(response.headers.entries()));

      if (response.ok) {
        const createdTask = await response.json();
        console.log('✅ Task created successfully:', createdTask);
        
        // Test updating the task
        console.log('Testing task update...');
        const updateTask = {
          ...testTask,
          title: "Updated Test Task",
          notes: testTask.notes + "\n\nUpdated by debug script"
        };

        const updateResponse = await fetch(`https://www.googleapis.com/tasks/v1/lists/@default/tasks/${createdTask.id}`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(updateTask)
        });

        console.log('Update response status:', updateResponse.status);

        if (updateResponse.ok) {
          const updatedTask = await updateResponse.json();
          console.log('✅ Task updated successfully:', updatedTask);
        } else {
          const errorText = await updateResponse.text();
          console.error('❌ Task update failed:', updateResponse.status, errorText);
        }

      } else {
        const errorText = await response.text();
        console.error('❌ Task creation failed:', response.status, errorText);
      }

    } catch (error) {
      console.error('❌ Error during API test:', error);
    }
  });
}

// Function to list existing tasks
async function listTasks() {
  console.log('Listing existing tasks...');
  
  chrome.storage.local.get(['googleAccessToken'], async (result) => {
    if (!result.googleAccessToken) {
      console.error('No access token found.');
      return;
    }

    try {
      const response = await fetch('https://www.googleapis.com/tasks/v1/lists/@default/tasks', {
        headers: {
          'Authorization': `Bearer ${result.googleAccessToken}`,
        }
      });

      if (response.ok) {
        const data = await response.json();
        console.log('Existing tasks:', data);
      } else {
        const errorText = await response.text();
        console.error('Failed to list tasks:', response.status, errorText);
      }
    } catch (error) {
      console.error('Error listing tasks:', error);
    }
  });
}

// Run the tests
console.log('Run testTaskCreation() to test task creation and update');
console.log('Run listTasks() to see existing tasks');

// Auto-run if you want
// testTaskCreation();
// listTasks();
