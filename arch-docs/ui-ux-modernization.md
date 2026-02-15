# UI/UX Modernization Plan: "Marks: Text Highlighter"

## 1. Current UI/UX Audit

The current interface of the "Marks: Text Highlighter" extension is functional and straightforward, but it lacks a cohesive design language and modern aesthetic.

### Key Observations:
*   **Utilitarian Aesthetic**: The UI uses standard browser fonts and basic CSS borders/backgrounds, giving it a "default" or dated feel.
*   **Visual Hierarchy**: In the popup, all actions (Clear All, View All, Delete Custom Colors) have equal weight, which can be overwhelming. The "No highlights" state is a bit plain.
*   **Density & Spacing**: Spacing is inconsistent in some areas, especially between the color selectors and the highlights list.
*   **Interaction Feedback**: While some animations exist (like the jelly bounce), overall transitions between states (e.g., opening the custom color picker) could be smoother.
*   **Typography**: Reliance on system fonts without refined weight or sizing makes the text feel secondary to the functional blocks.

---

## 2. New Design Concept: "Luminous Clarity"

The proposed concept, **"Luminous Clarity,"** focuses on making the user's highlights the hero of the interface. It emphasizes a clean, airy, and sophisticated look that feels like a native part of a modern OS (like macOS or Windows 11).

### Design Pillars:
1.  **Focus on Content**: Highlights should look like elegant annotations, not just colored blocks.
2.  **Soft Precision**: Use rounded corners (12px+), subtle shadows, and a refined color palette.
3.  **Delightful Interaction**: Smooth, meaningful transitions that provide clear feedback for every user action.
4.  **Information Density**: Optimize space for readability rather than just packing features.

---

## 3. UI Modification Plan

### 3.1. Style Guide (Foundational Changes)

*   **Typography**:
    *   Primary: `Inter`, `Segoe UI Variable`, or `-apple-system`.
    *   Scale: Use a clear 12px (caption), 14px (body), 18px (heading) scale with varied weights (400, 500, 600).
*   **Color Palette**:
    *   Backgrounds: Pure white (`#FFFFFF`) for light mode, Deep Charcoal (`#121212`) for dark mode.
    *   Accents: A sophisticated "Electric Blue" (`#007AFF`) for primary actions.
    *   Surface Colors: Soft greys (`#F5F5F7` / `#1C1C1E`) for card backgrounds.
*   **Shadows**:
    *   Level 1 (Buttons/Cards): `0 2px 8px rgba(0,0,0,0.05)`
    *   Level 2 (Popups/Modals): `0 8px 32px rgba(0,0,0,0.12)`

### 3.2. Component-Specific Improvements

#### A. Main Popup (`popup.html`)
*   **Header**: Move "Text Highlighter" to a more subtle, left-aligned position with a small icon. Add a "Settings" gear icon on the top right.
*   **Highlight Cards**: Instead of a simple list, use cards with a subtle border and a tiny color indicator on the left.
*   **Primary Action**: Highlight the "View All Pages" button as the primary navigation point, perhaps using the accent color.
*   **Toggle Redesign**: Replace standard checkboxes with sleek, animated toggle switches.

#### B. Pages List Dashboard (`pages-list.html`)
*   **Search Bar**: Make it more prominent with a soft-grey background and an magnifying glass icon inside.
*   **Page Cards**: Use a "Grid" or "Rich List" view. Each card should show:
    *   The page favicon.
    *   Truncated title and URL.
    *   A badge showing the count of highlights.
    *   A "Quick Preview" of the most recent highlight.
*   **Batch Actions**: Add a "Selection Mode" to delete or export multiple pages at once.

#### C. Selection Controls (`controls.js`)
*   **Glassmorphism**: Use `backdrop-filter: blur(10px)` with a semi-transparent background.
*   **Compact Mode**: On desktop, show a minimal version that expands when hovered or clicked.
*   **New Animation**: A "Slide & Fade" entry from the point of selection.

#### D. Minimap (`minimap.js`)
*   **Subtlety**: Reduce opacity to 20-30% when not hovered.
*   **Magnifier Effect**: On hover, slightly widen the minimap and show a tooltip with a snippet of the highlight text.

---

## 4. Implementation Strategy

### Phase 1: Foundation (CSS Refactor)
*   Define CSS variables for colors, spacing, and shadows in `styles.css`.
*   Apply the new typography across all HTML files.

### Phase 2: Popup & Pages List Overhaul
*   Restructure `popup.html` and `pages-list.html` to follow the card-based layout.
*   Implement the new "Dashboard" feel for the pages list.

### Phase 3: Interaction & Motion
*   Refine `controls.js` animations.
*   Add micro-interactions (hover scales, smooth color transitions) to all buttons.

### Phase 4: Refinement & Dark Mode
*   Ensure perfect contrast and legibility in the dark theme.
*   Optimize for mobile (Firefox Android) with larger touch targets and simplified layouts.
