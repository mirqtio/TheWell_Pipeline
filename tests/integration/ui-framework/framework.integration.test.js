/**
 * UI Framework Integration Tests
 * Tests the integration of all framework components
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  ThemeProvider,
  ToastProvider,
  LoadingProvider,
  ErrorBoundary,
  Button,
  Form,
  Input,
  Modal,
  useToast,
  useApi,
  validationRules,
} from '../../../src/web/ui-framework';

// Test component that uses multiple framework features
const TestApp = () => {
  const [modalOpen, setModalOpen] = React.useState(false);
  const toast = useToast();
  const { data, loading, error, refetch } = useApi('/test-data', {
    autoFetch: false,
  });

  const handleSubmit = async (formData) => {
    try {
      await refetch({ data: formData });
      toast.success('Form submitted successfully!');
      setModalOpen(false);
    } catch (err) {
      toast.error('Failed to submit form');
    }
  };

  return (
    <div>
      <h1>Test Application</h1>
      
      <Button onClick={() => setModalOpen(true)}>
        Open Form Modal
      </Button>

      {loading && <p>Loading...</p>}
      {error && <p>Error: {error.message}</p>}
      {data && <p>Data: {JSON.stringify(data)}</p>}

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Test Form"
      >
        <Form onSubmit={handleSubmit}>
          <Form.Field
            name="email"
            rules={{
              required: 'Email is required',
              ...validationRules.email,
            }}
            render={({ register, error }) => (
              <Input
                {...register}
                type="email"
                label="Email"
                error={error}
                placeholder="Enter your email"
              />
            )}
          />
          
          <Form.Field
            name="message"
            rules={{
              required: 'Message is required',
              ...validationRules.minLength(10),
            }}
            render={({ register, error }) => (
              <Input
                {...register}
                label="Message"
                error={error}
                placeholder="Enter your message"
              />
            )}
          />
          
          <Form.Actions>
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Form.SubmitButton>Submit</Form.SubmitButton>
          </Form.Actions>
        </Form>
      </Modal>
    </div>
  );
};

// Error component for testing error boundary
const ErrorComponent = () => {
  throw new Error('Test error');
};

describe('UI Framework Integration', () => {
  // Mock fetch for API calls
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const renderWithProviders = (ui) => {
    return render(
      <ErrorBoundary>
        <ThemeProvider>
          <LoadingProvider>
            <ToastProvider>
              {ui}
            </ToastProvider>
          </LoadingProvider>
        </ThemeProvider>
      </ErrorBoundary>
    );
  };

  describe('Component Integration', () => {
    it('renders the test app with all providers', () => {
      renderWithProviders(<TestApp />);
      
      expect(screen.getByText('Test Application')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Open Form Modal' })).toBeInTheDocument();
    });

    it('opens modal and displays form', async () => {
      renderWithProviders(<TestApp />);
      
      fireEvent.click(screen.getByRole('button', { name: 'Open Form Modal' }));
      
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByLabelText('Email')).toBeInTheDocument();
        expect(screen.getByLabelText('Message')).toBeInTheDocument();
      });
    });

    it('validates form fields', async () => {
      renderWithProviders(<TestApp />);
      
      fireEvent.click(screen.getByRole('button', { name: 'Open Form Modal' }));
      
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Try to submit without filling fields
      fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
      
      await waitFor(() => {
        expect(screen.getByText('Email is required')).toBeInTheDocument();
        expect(screen.getByText('Message is required')).toBeInTheDocument();
      });

      // Fill with invalid email
      fireEvent.change(screen.getByLabelText('Email'), {
        target: { value: 'invalid-email' },
      });
      fireEvent.blur(screen.getByLabelText('Email'));
      
      await waitFor(() => {
        expect(screen.getByText('Invalid email address')).toBeInTheDocument();
      });

      // Fill with short message
      fireEvent.change(screen.getByLabelText('Message'), {
        target: { value: 'Short' },
      });
      fireEvent.blur(screen.getByLabelText('Message'));
      
      await waitFor(() => {
        expect(screen.getByText('Must be at least 10 characters')).toBeInTheDocument();
      });
    });

    it('submits form and shows toast notification', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      renderWithProviders(<TestApp />);
      
      fireEvent.click(screen.getByRole('button', { name: 'Open Form Modal' }));
      
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Fill form with valid data
      fireEvent.change(screen.getByLabelText('Email'), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByLabelText('Message'), {
        target: { value: 'This is a test message' },
      });

      // Submit form
      fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
      
      await waitFor(() => {
        // Modal should close
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        
        // Toast should appear
        expect(screen.getByText('Form submitted successfully!')).toBeInTheDocument();
      });
    });

    it('handles API errors gracefully', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Network error'));

      renderWithProviders(<TestApp />);
      
      fireEvent.click(screen.getByRole('button', { name: 'Open Form Modal' }));
      
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Fill and submit form
      fireEvent.change(screen.getByLabelText('Email'), {
        target: { value: 'test@example.com' },
      });
      fireEvent.change(screen.getByLabelText('Message'), {
        target: { value: 'This is a test message' },
      });
      
      fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
      
      await waitFor(() => {
        // Error toast should appear
        expect(screen.getByText('Failed to submit form')).toBeInTheDocument();
        
        // Modal should remain open
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
    });
  });

  describe('Theme Integration', () => {
    it('applies theme classes correctly', () => {
      const { container } = renderWithProviders(<TestApp />);
      
      expect(document.documentElement).toHaveClass('light-theme');
    });

    it('supports dark theme', () => {
      render(
        <ThemeProvider initialMode="dark">
          <Button>Dark Theme Button</Button>
        </ThemeProvider>
      );
      
      expect(document.documentElement).toHaveClass('dark-theme');
    });
  });

  describe('Error Boundary Integration', () => {
    // Suppress console errors for this test
    const originalError = console.error;
    beforeEach(() => {
      console.error = jest.fn();
    });
    
    afterEach(() => {
      console.error = originalError;
    });

    it('catches and displays errors', () => {
      renderWithProviders(<ErrorComponent />);
      
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('supports keyboard navigation in modal', async () => {
      renderWithProviders(<TestApp />);
      
      const openButton = screen.getByRole('button', { name: 'Open Form Modal' });
      openButton.focus();
      fireEvent.keyDown(openButton, { key: 'Enter' });
      
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Focus should be trapped in modal
      const emailInput = screen.getByLabelText('Email');
      expect(document.activeElement).toBe(emailInput);
    });

    it('announces toast notifications to screen readers', async () => {
      renderWithProviders(<TestApp />);
      
      // Trigger a toast
      fireEvent.click(screen.getByRole('button', { name: 'Open Form Modal' }));
      
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Close modal to trigger error
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      
      // Check for ARIA live region
      const toastContainer = document.querySelector('[role="region"][aria-live="polite"]');
      expect(toastContainer).toBeInTheDocument();
    });
  });
});