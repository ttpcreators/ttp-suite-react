import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/*
 * Alerte / notification (composant 21st.dev), adaptée au code couleur de l'app :
 * gris = information, VERT = réussi, ROUGE = erreur. Pas d'orange : « warning »
 * reste neutre (l'icône porte le sens). Utilisée par les notifications du bas (toast).
 */
const alertVariants = cva("relative rounded-lg border", {
  variants: {
    variant: {
      default: "border-border bg-surface text-foreground",
      warning: "border-border bg-surface text-foreground",
      error: "border-red-500/40 bg-surface text-foreground",
      success: "border-emerald-500/40 bg-surface text-foreground",
      info: "border-border bg-surface text-foreground",
    },
    size: {
      sm: "px-4 py-3",
      lg: "p-4",
    },
    isNotification: {
      true: "z-[100] max-w-[400px] bg-surface shadow-lg shadow-black/5",
      false: "",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "sm",
    isNotification: false,
  },
});

export type AlertVariant = NonNullable<VariantProps<typeof alertVariants>["variant"]>;

interface AlertProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {
  icon?: React.ReactNode;
  action?: React.ReactNode;
  layout?: "row" | "complex";
}

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, size, isNotification, icon, action, layout = "row", children, ...props }, ref) => (
    <div ref={ref} role="alert" className={cn(alertVariants({ variant, size, isNotification }), className)} {...props}>
      {layout === "row" ? (
        // Une ligne
        <div className="flex items-center gap-2">
          <div className="flex grow items-center">
            {icon && <span className="me-3 inline-flex shrink-0">{icon}</span>}
            {children}
          </div>
          {action && <div className="flex shrink-0 items-center">{action}</div>}
        </div>
      ) : (
        // Plusieurs lignes (titre + description)
        <div className="flex gap-2">
          {icon && children ? (
            <div className="flex grow gap-3">
              <span className="mt-0.5 shrink-0">{icon}</span>
              <div className="grow">{children}</div>
            </div>
          ) : (
            <div className="grow">
              {icon && <span className="me-3 inline-flex">{icon}</span>}
              {children}
            </div>
          )}
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
    </div>
  ),
);
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => <h5 ref={ref} className={cn("text-sm font-medium", className)} {...props} />,
);
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />,
);
AlertDescription.displayName = "AlertDescription";

const AlertContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("space-y-1", className)} {...props} />,
);
AlertContent.displayName = "AlertContent";

export { Alert, AlertTitle, AlertDescription, AlertContent };

export default Alert;
