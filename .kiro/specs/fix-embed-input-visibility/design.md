# Design Document

## Overview

The chatbot input area is not visible when the embed page first loads due to a layout issue where the suggested questions component is pushing the input area below the visible viewport. The suggested questions are currently placed inside the scrollable messages area, which can cause the input area (positioned at the bottom) to be pushed out of view. The solution involves repositioning the suggested questions or adjusting the layout to ensure the input area remains visible.

## Architecture

The current layout structure in the embed page:
```
SidebarInset
├── Top Controls (sticky)
├── Messages Area (flex-1, overflow-y-scroll)
│   ├── Greeting (when no messages)
│   ├── Message Groups
│   ├── Suggested Questions (when no messages + tools available) ← PROBLEM
│   └── Scroll target
├── File Upload Area (conditional)
└── Input Area (flex-shrink-0) ← GETS PUSHED DOWN
```

The target architecture will ensure the input area is always visible:
```
SidebarInset
├── Top Controls (sticky)
├── Messages Area (flex-1, overflow-y-scroll, with proper height constraints)
│   ├── Greeting (when no messages)
│   ├── Message Groups
│   └── Scroll target
├── Suggested Questions (positioned outside messages area) ← SOLUTION
├── File Upload Area (conditional)
└── Input Area (flex-shrink-0, always visible)
```

## Components and Interfaces

### Layout Container Structure
- **SidebarInset**: Main container with flex column layout
- **Messages Area**: Scrollable container with `flex-1` and `min-h-0` for proper flex behavior
- **Suggested Questions**: Repositioned outside the scrollable messages area
- **Input Area**: Fixed at bottom with `flex-shrink-0`

### CSS Classes Analysis
- `flex-1`: Takes available space
- `overflow-y-scroll`: Allows scrolling when content overflows
- `min-h-0`: Prevents flex item from growing beyond container
- `flex-shrink-0`: Prevents element from shrinking

### Component Positioning
- **Suggested Questions Component**: Currently inside messages area, needs to be moved outside
- **Input Area**: Should remain at bottom but always visible
- **Messages**: Should scroll independently without affecting input position

## Data Models

### Layout State
```typescript
interface LayoutState {
  showSuggestedQuestions: boolean; // when no messages and tools available
  hasMessages: boolean; // determines if greeting/suggestions show
  inputAreaVisible: boolean; // should always be true
}
```

### Suggested Questions Props
```typescript
interface SuggestedQuestionsProps {
  onQuestionSelect: (question: string) => void;
  onQuestionSubmit: (question: string) => Promise<void>;
  enabledTools: string[];
}
```

## Error Handling

### Layout Overflow
- Ensure messages area has proper height constraints
- Prevent suggested questions from causing viewport overflow
- Maintain input area visibility across different screen sizes

### Responsive Design
- Test layout on mobile devices where viewport height is limited
- Ensure suggested questions don't break responsive behavior
- Maintain proper spacing and padding

## Testing Strategy

### Visual Testing
1. Load embed page with no messages
2. Verify input area is immediately visible
3. Check that suggested questions appear without pushing input down
4. Test on different screen sizes (mobile, tablet, desktop)
5. Verify scrolling behavior in messages area

### Interaction Testing
1. Click suggested questions and verify they populate input
2. Submit suggested questions and verify normal chat flow
3. Test that input area remains accessible during interactions
4. Verify keyboard navigation works properly

### Layout Testing
1. Test with different numbers of suggested questions
2. Verify layout with and without tools enabled
3. Test rapid toggling between states
4. Check layout stability during window resizing

## Implementation Approach

### Option 1: Move Suggested Questions Outside Messages Area (Recommended)
- Position suggested questions between messages area and input area
- Maintain current styling and functionality
- Ensure proper spacing and responsive behavior

### Option 2: Constrain Messages Area Height
- Set explicit height constraints on messages area
- Keep suggested questions inside but prevent overflow
- May require more complex CSS calculations

### Option 3: Sticky Suggested Questions
- Position suggested questions as sticky within messages area
- Ensure they don't interfere with input area positioning
- More complex but maintains current component structure

## Selected Solution: Option 1

Move the suggested questions component outside the scrollable messages area to prevent it from affecting the input area positioning. This approach:
- Maintains current component functionality
- Provides clearest separation of concerns
- Ensures input area is always visible
- Simplifies layout debugging and maintenance