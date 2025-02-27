function parseAssignments() {
    // create a list to store the assignments
    let assignmentDict = {};

    // TODO: Implement parsing logic here

    let assignmentArray = document.querySelectorAll('.odd, .even');
    if (assignmentArray) {
        for (let element of assignmentArray) {
            let titleElement = element.querySelector('.js-submitAssignment');
            if (titleElement) {
                let title = titleElement.innerText;
                let dueDateElement = element.querySelector('.submissionTimeChart--dueDate');
                if (dueDateElement) {
                    assignmentDict[title] = dueDateElement.dateTime;
                }
            }
        }
    }
  // console.log(assignmentList);
  // console.log(datetimeValue);
  console.log(assignmentDict);
}

//