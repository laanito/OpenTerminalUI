import { Navigate, useLocation } from "react-router-dom";

type CompatibilityRedirectProps = {
  from: string;
  to: string;
};

export function CompatibilityRedirect({ from, to }: CompatibilityRedirectProps) {
  const location = useLocation();
  const suffix = location.pathname.startsWith(from)
    ? location.pathname.slice(from.length)
    : "";

  return (
    <Navigate
      to={`${to}${suffix}${location.search}${location.hash}`}
      replace
      state={location.state}
    />
  );
}
