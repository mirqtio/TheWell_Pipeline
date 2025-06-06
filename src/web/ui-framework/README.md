# TheWell UI Framework

A comprehensive, modern, and accessible React component library for building enterprise-grade applications.

## Features

- 🎨 **Design System**: Complete design tokens and theming support
- 🧩 **30+ Components**: Production-ready, accessible components
- 📱 **Responsive**: Mobile-first responsive design
- ♿ **Accessible**: WCAG 2.1 AA compliant
- 🚀 **Performance**: Optimized for speed and efficiency
- 🌙 **Dark Mode**: Built-in dark mode support
- 📖 **Documentation**: Comprehensive Storybook documentation
- 🧪 **Tested**: Unit, integration, and visual regression tests

## Quick Start

```jsx
import { ThemeProvider, Button, Card } from '@thewell/ui-framework';

function App() {
  return (
    <ThemeProvider>
      <Card>
        <Card.Header>
          <Card.Title>Welcome to TheWell</Card.Title>
        </Card.Header>
        <Card.Body>
          <Button variant="primary">Get Started</Button>
        </Card.Body>
      </Card>
    </ThemeProvider>
  );
}
```

## Installation

```bash
npm install classnames react-hook-form react-hot-toast focus-trap-react @floating-ui/react framer-motion
```

## Components

### Core Components
- `Button` - Versatile button with multiple variants
- `Badge` - Status indicators and labels
- `Card` - Flexible container component
- `Spinner` - Loading indicators

### Layout
- `Grid` - Responsive grid system
- `Container` - Responsive container with max-width
- `Stack` - Vertical/horizontal stacking
- `PageLayout` - Complete page templates

### Forms
- `Form` - Form wrapper with validation
- `Input` - Text input with validation
- `Select` - Dropdown select
- `Checkbox` - Checkbox and radio inputs
- `FileUpload` - Drag-and-drop file upload

### Notifications
- `Toast` - Non-blocking notifications
- `Alert` - Inline alerts
- `Modal` - Accessible modal dialogs

### Integration
- `ApiClient` - Unified API wrapper
- `ErrorBoundary` - Error handling
- `LoadingManager` - Loading state management

## Design System

### Colors
```css
/* Primary colors */
--color-primary-500: #2196f3;

/* Semantic colors */
--color-success-500: #4caf50;
--color-error-500: #f44336;
--color-warning-500: #ff9800;
```

### Spacing
```css
--spacing-1: 0.25rem;  /* 4px */
--spacing-2: 0.5rem;   /* 8px */
--spacing-4: 1rem;     /* 16px */
--spacing-8: 2rem;     /* 32px */
```

### Typography
```css
--font-size-sm: 0.875rem;  /* 14px */
--font-size-base: 1rem;    /* 16px */
--font-size-lg: 1.125rem;  /* 18px */
--font-size-xl: 1.25rem;   /* 20px */
```

## Hooks

- `useApi` - Data fetching with caching
- `useDebounce` - Debounce values and callbacks
- `useLocalStorage` - Persistent state
- `useMediaQuery` - Responsive helpers

## Development

### Run Storybook
```bash
npm run storybook
```

### Run Tests
```bash
npm test tests/unit/ui-framework
npm test tests/integration/ui-framework
```

### Build
```bash
npm run storybook:build
```

## Migration Guide

See the [Migration Guide](./docs/MigrationGuide.mdx) for detailed instructions on migrating existing components.

## Accessibility

All components are built with accessibility in mind:
- Semantic HTML
- ARIA attributes
- Keyboard navigation
- Screen reader support
- Focus management

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## Contributing

1. Create feature branch
2. Add tests
3. Update Storybook
4. Submit PR

## License

MIT