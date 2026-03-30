import type { Appearance, StripeElementsOptions } from "@stripe/stripe-js";

const stripeElementsAppearance: Appearance = {
    theme: "stripe",
    variables: {
        colorPrimary: "#17406b",
        colorText: "#163961",
        colorDanger: "#b42318",
        borderRadius: "14px",
    },
};

export function buildStripeElementsOptions(clientSecret: string): StripeElementsOptions {
    return {
        clientSecret,
        appearance: stripeElementsAppearance,
        loader: "auto",
    };
}
