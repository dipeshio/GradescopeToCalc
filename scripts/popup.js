document.addEventListener('DOMContentLoaded', () => {
  const syncButton = document.getElementById('syncButton');
  const statusDiv = document.getElementById('status');

  if (syncButton) {
    syncButton.addEventListener('click', async () => {
      try {
        // Get the active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab.url.includes('gradescope.com')) {
          statusDiv.textContent = 'Please navigate to Gradescope first';
          return;
        }

        // execute the script in the context of the page
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: () => {
            parseAssignments();
          }
        });
      } catch (error) {
        statusDiv.textContent = 'Error: ' + error.message;
        console.error(error);
      }
    });
  }
});