import type { Key, ReactNode } from "react";
import {
    Radio,
    RadioGroup,
    Switch,
    ToggleButton,
    ToggleButtonGroup,
} from "react-aria-components";

type ChoiceOption<T extends string> = {
    id: T;
    content: ReactNode;
    disabled?: boolean;
    className?: string;
};

type AppRadioCardsProps<T extends string> = {
    value: T;
    onChange: (next: T) => void;
    options: Array<ChoiceOption<T>>;
    className?: string;
    itemClassName?: string;
    activeClassName?: string;
    orientation?: "horizontal" | "vertical";
    ariaLabel: string;
    isDisabled?: boolean;
};

export function AppRadioCards<T extends string>({
    value,
    onChange,
    options,
    className = "",
    itemClassName = "",
    activeClassName = "is-active",
    orientation = "vertical",
    ariaLabel,
    isDisabled = false,
}: AppRadioCardsProps<T>) {
    return (
        <RadioGroup
            aria-label={ariaLabel}
            value={value}
            onChange={(next) => onChange(next as T)}
            orientation={orientation}
            className={className}
            isDisabled={isDisabled}
        >
            {options.map((option) => (
                <Radio
                    key={option.id}
                    value={option.id}
                    isDisabled={isDisabled || option.disabled}
                    className={({ isSelected }) =>
                        `${itemClassName} ${option.className ?? ""}${isSelected ? ` ${activeClassName}` : ""}`.trim()
                    }
                >
                    {option.content}
                </Radio>
            ))}
        </RadioGroup>
    );
}

type AppMultiToggleGroupProps<T extends string> = {
    values: T[];
    onChange: (next: T[]) => void;
    options: Array<ChoiceOption<T>>;
    className?: string;
    itemClassName?: string;
    activeClassName?: string;
    orientation?: "horizontal" | "vertical";
    ariaLabel: string;
};

export function AppMultiToggleGroup<T extends string>({
    values,
    onChange,
    options,
    className = "",
    itemClassName = "",
    activeClassName = "is-active",
    orientation = "horizontal",
    ariaLabel,
}: AppMultiToggleGroupProps<T>) {
    return (
        <ToggleButtonGroup
            aria-label={ariaLabel}
            selectionMode="multiple"
            selectedKeys={new Set(values)}
            onSelectionChange={(keys) => onChange(Array.from(keys as Iterable<Key>).map(String) as T[])}
            orientation={orientation}
            className={className}
        >
            {options.map((option) => (
                <ToggleButton
                    key={option.id}
                    id={option.id}
                    isDisabled={option.disabled}
                    className={({ isSelected }) =>
                        `${itemClassName} ${option.className ?? ""}${isSelected ? ` ${activeClassName}` : ""}`.trim()
                    }
                >
                    {option.content}
                </ToggleButton>
            ))}
        </ToggleButtonGroup>
    );
}

type AppSwitchFieldProps = {
    label: string;
    isSelected: boolean;
    onChange: (next: boolean) => void;
    isDisabled?: boolean;
    className?: string;
};

export function AppSwitchField({
    label,
    isSelected,
    onChange,
    isDisabled = false,
    className = "",
}: AppSwitchFieldProps) {
    return (
        <Switch
            isSelected={isSelected}
            onChange={onChange}
            isDisabled={isDisabled}
            className={({ isDisabled: disabled, isSelected: selected }) =>
                `appSwitch ${className}${selected ? " is-active" : ""}${disabled ? " is-disabled" : ""}`.trim()
            }
        >
            <span className="appSwitchTrack" aria-hidden="true" />
            <span className="appSwitchLabel">{label}</span>
        </Switch>
    );
}
