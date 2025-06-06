/**
 * Button Component Stories
 */

import React from 'react';
import { Button, ButtonGroup } from './Button';

export default {
  title: 'Components/Button',
  component: Button,
  parameters: {
    docs: {
      description: {
        component: 'Accessible button component with multiple variants and states.',
      },
    },
  },
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'tertiary', 'danger', 'ghost'],
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
    },
    disabled: { control: 'boolean' },
    loading: { control: 'boolean' },
    fullWidth: { control: 'boolean' },
  },
};

// Default story
export const Default = {
  args: {
    children: 'Button',
  },
};

// Variants
export const Variants = () => (
  <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
    <Button variant="primary">Primary</Button>
    <Button variant="secondary">Secondary</Button>
    <Button variant="tertiary">Tertiary</Button>
    <Button variant="danger">Danger</Button>
    <Button variant="ghost">Ghost</Button>
  </div>
);

// Sizes
export const Sizes = () => (
  <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
    <Button size="sm">Small</Button>
    <Button size="md">Medium</Button>
    <Button size="lg">Large</Button>
  </div>
);

// States
export const States = () => (
  <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
    <Button>Normal</Button>
    <Button disabled>Disabled</Button>
    <Button loading>Loading</Button>
  </div>
);

// With Icons
export const WithIcons = () => {
  const icon = (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zM7 11V5h2v6H7zm0 2v-2h2v2H7z" />
    </svg>
  );

  return (
    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
      <Button leftIcon={icon}>Left Icon</Button>
      <Button rightIcon={icon}>Right Icon</Button>
      <Button leftIcon={icon} rightIcon={icon}>Both Icons</Button>
    </div>
  );
};

// Button Group Example
export const GroupExample = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
    <ButtonGroup>
      <Button variant="secondary">Left</Button>
      <Button variant="secondary">Center</Button>
      <Button variant="secondary">Right</Button>
    </ButtonGroup>
    
    <ButtonGroup>
      <Button variant="primary">Save</Button>
      <Button variant="ghost">Cancel</Button>
    </ButtonGroup>
  </div>
);

// Full Width
export const FullWidth = () => (
  <div style={{ maxWidth: '400px' }}>
    <Button fullWidth>Full Width Button</Button>
  </div>
);

// As Link
export const AsLink = () => (
  <Button as="a" href="#" variant="tertiary">
    Button as Link
  </Button>
);

// Playground
export const Playground = {
  args: {
    children: 'Playground Button',
    variant: 'primary',
    size: 'md',
    disabled: false,
    loading: false,
    fullWidth: false,
  },
};