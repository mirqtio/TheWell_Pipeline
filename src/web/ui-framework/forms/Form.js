/**
 * Form Component with Validation
 * Enhanced form wrapper with built-in validation using react-hook-form
 */

import React from 'react';
import { useForm, FormProvider, useFormContext } from 'react-hook-form';
import classNames from 'classnames';
import { Button } from '../components/Button';
import './Form.css';

// Form Component
export const Form = ({
  children,
  onSubmit,
  defaultValues,
  validationSchema,
  className,
  ...props
}) => {
  const methods = useForm({
    defaultValues,
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  const classes = classNames('tw-form', className);

  const handleSubmit = methods.handleSubmit(async (data) => {
    try {
      await onSubmit(data);
    } catch (error) {
      console.error('Form submission error:', error);
    }
  });

  return (
    <FormProvider {...methods}>
      <form className={classes} onSubmit={handleSubmit} noValidate {...props}>
        {children}
      </form>
    </FormProvider>
  );
};

// Form Field Component
export const FormField = ({
  name,
  label,
  helper,
  required = false,
  rules = {},
  render,
  className,
}) => {
  const {
    register,
    formState: { errors },
    control,
  } = useFormContext();

  const error = errors[name];
  const fieldRules = {
    ...rules,
    ...(required ? { required: 'This field is required' } : {}),
  };

  const classes = classNames('tw-form-field', className);

  return (
    <div className={classes}>
      {render({
        name,
        label,
        helper,
        error: error?.message,
        required,
        register: register(name, fieldRules),
        control,
      })}
    </div>
  );
};

// Form Section Component
export const FormSection = ({
  title,
  description,
  children,
  className,
  ...props
}) => {
  const classes = classNames('tw-form-section', className);

  return (
    <div className={classes} {...props}>
      {(title || description) && (
        <div className="tw-form-section__header">
          {title && <h3 className="tw-form-section__title">{title}</h3>}
          {description && <p className="tw-form-section__description">{description}</p>}
        </div>
      )}
      <div className="tw-form-section__content">
        {children}
      </div>
    </div>
  );
};

// Form Actions Component
export const FormActions = ({
  children,
  align = 'right',
  className,
  ...props
}) => {
  const classes = classNames(
    'tw-form-actions',
    `tw-form-actions--${align}`,
    className
  );

  return (
    <div className={classes} {...props}>
      {children}
    </div>
  );
};

// Submit Button Component
export const SubmitButton = ({
  children = 'Submit',
  loading,
  ...props
}) => {
  const { formState: { isSubmitting, isValid } } = useFormContext();

  return (
    <Button
      type="submit"
      loading={loading || isSubmitting}
      disabled={!isValid}
      {...props}
    >
      {children}
    </Button>
  );
};

// Reset Button Component
export const ResetButton = ({
  children = 'Reset',
  onReset,
  ...props
}) => {
  const { reset } = useFormContext();

  const handleReset = (e) => {
    e.preventDefault();
    reset();
    if (onReset) {
      onReset();
    }
  };

  return (
    <Button
      type="button"
      variant="secondary"
      onClick={handleReset}
      {...props}
    >
      {children}
    </Button>
  );
};

// Common validation rules
export const validationRules = {
  email: {
    pattern: {
      value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
      message: 'Invalid email address',
    },
  },
  
  phone: {
    pattern: {
      value: /^[\d\s\-\+\(\)]+$/,
      message: 'Invalid phone number',
    },
  },
  
  url: {
    pattern: {
      value: /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/,
      message: 'Invalid URL',
    },
  },
  
  minLength: (min) => ({
    minLength: {
      value: min,
      message: `Must be at least ${min} characters`,
    },
  }),
  
  maxLength: (max) => ({
    maxLength: {
      value: max,
      message: `Must be no more than ${max} characters`,
    },
  }),
  
  min: (min) => ({
    min: {
      value: min,
      message: `Must be at least ${min}`,
    },
  }),
  
  max: (max) => ({
    max: {
      value: max,
      message: `Must be no more than ${max}`,
    },
  }),
  
  pattern: (pattern, message) => ({
    pattern: {
      value: pattern,
      message: message || 'Invalid format',
    },
  }),
};

// Compound component pattern
Form.Field = FormField;
Form.Section = FormSection;
Form.Actions = FormActions;
Form.SubmitButton = SubmitButton;
Form.ResetButton = ResetButton;