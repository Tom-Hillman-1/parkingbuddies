import type { ReactNode } from "react";
import { Button, Disclosure, DisclosurePanel, Heading } from "react-aria-components";

type AppDisclosureProps = {
    defaultExpanded?: boolean;
    className?: string;
    triggerClassName?: string;
    panelClassName?: string;
    trigger: (isExpanded: boolean) => ReactNode;
    onTriggerPress?: () => void;
    children: ReactNode;
};

export function AppDisclosure({
    defaultExpanded = false,
    className = "",
    triggerClassName = "",
    panelClassName = "",
    trigger,
    onTriggerPress,
    children,
}: AppDisclosureProps) {
    return (
        <Disclosure defaultExpanded={defaultExpanded} className={className}>
            {({ isExpanded }) => (
                <>
                    <Heading level={3} className="appDisclosureHeading">
                        <Button
                            slot="trigger"
                            className={`${triggerClassName}${isExpanded ? " is-open" : ""}`.trim()}
                            onPress={onTriggerPress}
                        >
                            {trigger(isExpanded)}
                        </Button>
                    </Heading>
                    <DisclosurePanel className={`${panelClassName}${isExpanded ? " is-open" : ""}`.trim()}>
                        {children}
                    </DisclosurePanel>
                </>
            )}
        </Disclosure>
    );
}
