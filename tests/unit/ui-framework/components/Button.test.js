/**
 * Button Component Tests
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Button, ButtonGroup } from '../../../../src/web/ui-framework/components/Button';

describe('Button Component', () => {
  describe('Basic Rendering', () => {
    it('renders with children', () => {
      render(<Button>Click me</Button>);
      expect(screen.getByRole('button')).toHaveTextContent('Click me');
    });

    it('renders with correct variant classes', () => {
      const { rerender } = render(<Button variant="primary">Button</Button>);
      expect(screen.getByRole('button')).toHaveClass('tw-button--primary');

      rerender(<Button variant="secondary">Button</Button>);
      expect(screen.getByRole('button')).toHaveClass('tw-button--secondary');

      rerender(<Button variant="danger">Button</Button>);
      expect(screen.getByRole('button')).toHaveClass('tw-button--danger');
    });

    it('renders with correct size classes', () => {
      const { rerender } = render(<Button size="sm">Button</Button>);
      expect(screen.getByRole('button')).toHaveClass('tw-button--sm');

      rerender(<Button size="lg">Button</Button>);
      expect(screen.getByRole('button')).toHaveClass('tw-button--lg');
    });
  });

  describe('States', () => {
    it('handles disabled state', () => {
      render(<Button disabled>Disabled</Button>);
      const button = screen.getByRole('button');
      expect(button).toBeDisabled();
      expect(button).toHaveClass('tw-button--disabled');
      expect(button).toHaveAttribute('aria-disabled', 'true');
    });

    it('handles loading state', () => {
      render(<Button loading>Loading</Button>);
      const button = screen.getByRole('button');
      expect(button).toBeDisabled();
      expect(button).toHaveClass('tw-button--loading');
      expect(button).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByRole('button').querySelector('.tw-button__spinner')).toBeInTheDocument();
    });

    it('handles full width', () => {
      render(<Button fullWidth>Full Width</Button>);
      expect(screen.getByRole('button')).toHaveClass('tw-button--full-width');
    });
  });

  describe('Icons', () => {
    const TestIcon = () => <span data-testid="test-icon">Icon</span>;

    it('renders with left icon', () => {
      render(<Button leftIcon={<TestIcon />}>Button</Button>);
      const icon = screen.getByTestId('test-icon');
      expect(icon.closest('.tw-button__icon--left')).toBeInTheDocument();
    });

    it('renders with right icon', () => {
      render(<Button rightIcon={<TestIcon />}>Button</Button>);
      const icon = screen.getByTestId('test-icon');
      expect(icon.closest('.tw-button__icon--right')).toBeInTheDocument();
    });

    it('hides icons when loading', () => {
      render(
        <Button loading leftIcon={<TestIcon />} rightIcon={<TestIcon />}>
          Button
        </Button>
      );
      expect(screen.queryByTestId('test-icon')).not.toBeInTheDocument();
    });
  });

  describe('Interactions', () => {
    it('handles click events', () => {
      const handleClick = jest.fn();
      render(<Button onClick={handleClick}>Click</Button>);
      
      fireEvent.click(screen.getByRole('button'));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('prevents click when disabled', () => {
      const handleClick = jest.fn();
      render(<Button disabled onClick={handleClick}>Click</Button>);
      
      fireEvent.click(screen.getByRole('button'));
      expect(handleClick).not.toHaveBeenCalled();
    });

    it('prevents click when loading', () => {
      const handleClick = jest.fn();
      render(<Button loading onClick={handleClick}>Click</Button>);
      
      fireEvent.click(screen.getByRole('button'));
      expect(handleClick).not.toHaveBeenCalled();
    });
  });

  describe('As Prop', () => {
    it('renders as different element', () => {
      render(
        <Button as="a" href="/test">
          Link Button
        </Button>
      );
      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('href', '/test');
      expect(link).toHaveClass('tw-button');
    });
  });

  describe('ButtonGroup', () => {
    it('renders children in a group', () => {
      render(
        <ButtonGroup>
          <Button>First</Button>
          <Button>Second</Button>
          <Button>Third</Button>
        </ButtonGroup>
      );
      
      expect(screen.getByRole('group')).toHaveClass('tw-button-group');
      expect(screen.getAllByRole('button')).toHaveLength(3);
    });

    it('applies custom className', () => {
      render(
        <ButtonGroup className="custom-group">
          <Button>Button</Button>
        </ButtonGroup>
      );
      
      expect(screen.getByRole('group')).toHaveClass('tw-button-group', 'custom-group');
    });
  });

  describe('Accessibility', () => {
    it('has proper ARIA attributes', () => {
      render(<Button>Accessible Button</Button>);
      const button = screen.getByRole('button');
      expect(button).toHaveAccessibleName('Accessible Button');
    });

    it('forwards ref', () => {
      const ref = React.createRef();
      render(<Button ref={ref}>Button</Button>);
      expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    });

    it('supports keyboard navigation', () => {
      const handleClick = jest.fn();
      render(<Button onClick={handleClick}>Button</Button>);
      
      const button = screen.getByRole('button');
      button.focus();
      expect(document.activeElement).toBe(button);
      
      fireEvent.keyDown(button, { key: 'Enter' });
      expect(handleClick).toHaveBeenCalled();
    });
  });
});