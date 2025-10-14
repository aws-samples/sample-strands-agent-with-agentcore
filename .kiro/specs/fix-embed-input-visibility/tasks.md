# Implementation Plan

- [x] 1. Analyze current layout structure and identify the exact positioning issue
  - Examine the embed page component structure in `/src/app/embed/page.tsx`
  - Identify where suggested questions are currently positioned within the messages area
  - Document the current flex layout hierarchy and CSS classes
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Reposition suggested questions component outside messages area
  - Move the SuggestedQuestions component from inside the messages area to between messages and input
  - Update the JSX structure to place suggested questions after the messages div but before file upload area
  - Maintain the conditional rendering logic (`groupedMessages.length === 0 && availableTools.length > 0`)
  - _Requirements: 1.1, 1.2, 3.1, 3.2_

- [x] 3. Adjust CSS classes and styling for proper layout
  - Ensure suggested questions container has appropriate spacing and margins
  - Verify the input area maintains `flex-shrink-0` to prevent it from being pushed down
  - Add proper responsive design classes for mobile and tablet views
  - Test that the layout works correctly across different screen sizes
  - _Requirements: 1.3, 3.2, 3.3_

- [ ] 4. Test and verify the layout fix
  - Load the embed page and verify input area is immediately visible
  - Test with different numbers of enabled tools to ensure suggested questions render correctly
  - Verify that clicking suggested questions still works properly
  - Test the layout on mobile, tablet, and desktop screen sizes
  - _Requirements: 1.1, 1.2, 1.3, 3.1, 3.2, 3.3_

- [ ]* 5. Add layout regression tests
  - Create visual regression tests to ensure input area visibility
  - Add tests for suggested questions positioning
  - Test responsive behavior across different viewport sizes
  - _Requirements: 1.1, 1.2, 1.3_