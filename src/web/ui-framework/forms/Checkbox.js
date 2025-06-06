/**
 * Checkbox and Radio Components
 * Accessible checkbox and radio inputs with custom styling
 */

import React, { forwardRef } from 'react';
import classNames from 'classnames';
import './Checkbox.css';

// Checkbox Component
export const Checkbox = forwardRef(({
  label,
  helper,
  error,
  disabled = false,
  indeterminate = false,
  className,
  containerClassName,
  id,
  onChange,
  ...props
}, ref) => {
  const checkboxId = id || `checkbox-${Math.random().toString(36).substr(2, 9)}`;
  
  const containerClasses = classNames(
    'tw-checkbox-container',
    containerClassName
  );
  
  const checkboxClasses = classNames(
    'tw-checkbox',
    {
      'tw-checkbox--error': error,
      'tw-checkbox--disabled': disabled,
    },
    className
  );

  React.useEffect(() => {
    if (ref?.current && indeterminate !== undefined) {
      ref.current.indeterminate = indeterminate;
    }
  }, [indeterminate, ref]);

  return (
    <div className={containerClasses}>
      <div className="tw-checkbox__wrapper">
        <input
          ref={ref}
          id={checkboxId}
          type="checkbox"
          className={checkboxClasses}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={
            error ? `${checkboxId}-error` :
              helper ? `${checkboxId}-helper` :
                undefined
          }
          onChange={onChange}
          {...props}
        />
        
        {label && (
          <label htmlFor={checkboxId} className="tw-checkbox__label">
            {label}
          </label>
        )}
      </div>
      
      {error && (
        <div id={`${checkboxId}-error`} className="tw-checkbox__error" role="alert">
          {error}
        </div>
      )}
      
      {!error && helper && (
        <div id={`${checkboxId}-helper`} className="tw-checkbox__helper">
          {helper}
        </div>
      )}
    </div>
  );
});

Checkbox.displayName = 'Checkbox';

// Radio Component
export const Radio = forwardRef(({
  label,
  helper,
  error,
  disabled = false,
  className,
  containerClassName,
  id,
  name,
  ...props
}, ref) => {
  const radioId = id || `radio-${Math.random().toString(36).substr(2, 9)}`;
  
  const containerClasses = classNames(
    'tw-radio-container',
    containerClassName
  );
  
  const radioClasses = classNames(
    'tw-radio',
    {
      'tw-radio--error': error,
      'tw-radio--disabled': disabled,
    },
    className
  );

  return (
    <div className={containerClasses}>
      <div className="tw-radio__wrapper">
        <input
          ref={ref}
          id={radioId}
          type="radio"
          name={name}
          className={radioClasses}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={
            error ? `${radioId}-error` :
              helper ? `${radioId}-helper` :
                undefined
          }
          {...props}
        />
        
        {label && (
          <label htmlFor={radioId} className="tw-radio__label">
            {label}
          </label>
        )}
      </div>
      
      {error && (
        <div id={`${radioId}-error`} className="tw-radio__error" role="alert">
          {error}
        </div>
      )}
      
      {!error && helper && (
        <div id={`${radioId}-helper`} className="tw-radio__helper">
          {helper}
        </div>
      )}
    </div>
  );
});

Radio.displayName = 'Radio';

// Radio Group Component
export const RadioGroup = ({
  name,
  label,
  options = [],
  value,
  onChange,
  error,
  helper,
  required = false,
  disabled = false,
  orientation = 'vertical',
  className,
  ...props
}) => {
  const groupId = `radio-group-${Math.random().toString(36).substr(2, 9)}`;
  
  const classes = classNames(
    'tw-radio-group',
    `tw-radio-group--${orientation}`,
    className
  );

  return (
    <fieldset className={classes} {...props}>
      {label && (
        <legend className="tw-radio-group__label">
          {label}
          {required && <span className="tw-radio-group__required" aria-label="required">*</span>}
        </legend>
      )}
      
      <div className="tw-radio-group__options">
        {options.map((option) => (
          <Radio
            key={option.value}
            name={name}
            label={option.label}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            disabled={disabled || option.disabled}
          />
        ))}
      </div>
      
      {error && (
        <div className="tw-radio-group__error" role="alert">
          {error}
        </div>
      )}
      
      {!error && helper && (
        <div className="tw-radio-group__helper">
          {helper}
        </div>
      )}
    </fieldset>
  );
};

// Checkbox Group Component
export const CheckboxGroup = ({
  label,
  options = [],
  value = [],
  onChange,
  error,
  helper,
  required = false,
  disabled = false,
  orientation = 'vertical',
  className,
  ...props
}) => {
  const classes = classNames(
    'tw-checkbox-group',
    `tw-checkbox-group--${orientation}`,
    className
  );

  const handleChange = (optionValue, checked) => {
    if (checked) {
      onChange([...value, optionValue]);
    } else {
      onChange(value.filter(v => v !== optionValue));
    }
  };

  return (
    <fieldset className={classes} {...props}>
      {label && (
        <legend className="tw-checkbox-group__label">
          {label}
          {required && <span className="tw-checkbox-group__required" aria-label="required">*</span>}
        </legend>
      )}
      
      <div className="tw-checkbox-group__options">
        {options.map((option) => (
          <Checkbox
            key={option.value}
            label={option.label}
            value={option.value}
            checked={value.includes(option.value)}
            onChange={(e) => handleChange(option.value, e.target.checked)}
            disabled={disabled || option.disabled}
          />
        ))}
      </div>
      
      {error && (
        <div className="tw-checkbox-group__error" role="alert">
          {error}
        </div>
      )}
      
      {!error && helper && (
        <div className="tw-checkbox-group__helper">
          {helper}
        </div>
      )}
    </fieldset>
  );
};