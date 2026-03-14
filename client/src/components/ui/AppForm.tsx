import { forwardRef } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Button, Input, TextArea } from "react-aria-components";

type AppFieldProps = {
    label: string;
    description?: ReactNode;
    error?: ReactNode;
    children: ReactNode;
    className?: string;
};

export function AppField({ label, description, error, children, className = "" }: AppFieldProps) {
    return (
        <div className={`appField ${className}`.trim()}>
            <div className="appFieldLabel">{label}</div>
            {children}
            {description ? <div className="appFieldDescription">{description}</div> : null}
            {error ? <div className="spotAlert">{error}</div> : null}
        </div>
    );
}

export const AppInput = forwardRef<HTMLInputElement, ComponentPropsWithoutRef<typeof Input>>(
    function AppInput({ className = "", ...props }, ref) {
        return <Input ref={ref} className={`input appInput ${className}`.trim()} {...props} />;
    }
);

export const AppSelect = forwardRef<HTMLSelectElement, ComponentPropsWithoutRef<"select">>(
    function AppSelect({ className = "", ...props }, ref) {
        return <select ref={ref} className={`input appInput ${className}`.trim()} {...props} />;
    }
);

export const AppTextarea = forwardRef<HTMLTextAreaElement, ComponentPropsWithoutRef<typeof TextArea>>(
    function AppTextarea({ className = "", ...props }, ref) {
        return <TextArea ref={ref} className={`input appInput ${className}`.trim()} {...props} />;
    }
);

type AppButtonProps = Omit<ComponentPropsWithoutRef<typeof Button>, "isDisabled"> & {
    variant?: "primary" | "secondary" | "ghost";
    disabled?: boolean;
};

export const AppButton = forwardRef<HTMLButtonElement, AppButtonProps>(
    function AppButton({ className = "", variant = "secondary", disabled, ...props }, ref) {
        const variantClass =
            variant === "primary" ? "btn-primary" : variant === "ghost" ? "btn-ghost" : "";
        return (
            <Button
                ref={ref}
                className={`btn ${variantClass} ${className}`.trim()}
                isDisabled={disabled}
                {...props}
            />
        );
    }
);
