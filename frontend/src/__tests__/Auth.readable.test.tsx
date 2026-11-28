import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ login: vi.fn(), register: vi.fn(), post: vi.fn(), navigate: vi.fn() }));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ login: mocks.login, register: mocks.register, isLoading: false }) }));
vi.mock("axios", () => ({ default: { create: () => ({ post: mocks.post }) } }));
vi.mock("react-router-dom", async () => ({ ...await vi.importActual<typeof import("react-router-dom")>("react-router-dom"), useNavigate: () => mocks.navigate }));
import { LoginPage } from "../pages/LoginPage";
import { RegisterPage } from "../pages/Auth/RegisterPage";
import { ForgotAccessPage } from "../pages/Auth/ForgotAccessPage";
const mount = (page: React.ReactNode) => render(<MemoryRouter initialEntries={["/login?redirect=/equity/notes"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{page}</MemoryRouter>);
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
const submit = () => fireEvent.submit(screen.getByRole("button", { name: /^(Access terminal|Create account|Reset access)$/ }).closest("form")!);
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); mocks.login.mockResolvedValue(undefined); mocks.register.mockResolvedValue(undefined); mocks.post.mockResolvedValue({}); });
afterEach(() => vi.useRealTimers());
it("labels login fields and password visibility without fake health metrics", () => {
  mount(<LoginPage />); change("PASSWORD", "retained-password"); fireEvent.click(screen.getByRole("button", { name: "Show password", exact: true })); expect(screen.getByLabelText("PASSWORD")).toHaveAttribute("type", "text"); expect(screen.getByRole("button", { name: "Hide password", exact: true })).toHaveAttribute("aria-pressed", "true"); submit(); expect(screen.getByRole("alert")).toHaveTextContent("CREDENTIALS REQUIRED"); expect(screen.queryByText(/99.97%|1,247|LATENCY/)).not.toBeInTheDocument();
});
it("retains failed login credentials and remembers only the email after success", async () => {
  vi.useFakeTimers(); mount(<LoginPage />); change("USER ID", " trader@example.test "); change("PASSWORD", "password-123"); mocks.login.mockRejectedValueOnce(new Error("Denied")); await act(async () => submit()); expect(screen.getByRole("alert")).toHaveTextContent("AUTHENTICATION FAILED"); expect(screen.getByLabelText("PASSWORD")).toHaveValue("password-123"); fireEvent.click(screen.getByLabelText("Remember terminal")); await act(async () => { submit(); await vi.advanceTimersByTimeAsync(3000); }); expect(mocks.login).toHaveBeenCalledWith("trader@example.test", "password-123"); expect(localStorage.getItem("ot-login-user")).toBe("trader@example.test"); expect(mocks.navigate).toHaveBeenCalledWith("/equity/notes", { replace: true }); expect(localStorage.getItem("password")).toBeNull();
});
it("does not navigate after a pending login is abandoned", async () => {
  vi.useFakeTimers(); let done!: () => void; mocks.login.mockImplementationOnce(() => new Promise<void>(resolve => { done = resolve; })); const view = mount(<LoginPage />); change("USER ID", "trader@example.test"); change("PASSWORD", "password-123"); submit(); view.unmount(); await act(async () => { done(); await vi.advanceTimersByTimeAsync(4000); }); expect(mocks.navigate).not.toHaveBeenCalled();
});
it("validates registration confirmation before calling the existing endpoint", () => {
  mount(<RegisterPage />); change("Email", "new@example.test"); change("Password", "password-123"); change("Confirm password", "different"); submit(); expect(screen.getByRole("alert")).toHaveTextContent("PASSWORDS DO NOT MATCH"); expect(mocks.register).not.toHaveBeenCalled();
});
it("preserves role registration and automatic sign-in contracts", async () => {
  mount(<RegisterPage />); change("Email", " new@example.test "); change("Password", "password-123"); change("Confirm password", "password-123"); await act(async () => submit()); expect(mocks.register).toHaveBeenCalledWith("new@example.test", "password-123", "viewer"); expect(mocks.login).toHaveBeenCalledWith("new@example.test", "password-123"); expect(mocks.navigate).toHaveBeenCalledWith("/equity/stocks", { replace: true });
});
it("distinguishes an account created before automatic login failed", async () => {
  mocks.login.mockRejectedValueOnce(new Error("Denied")); mount(<RegisterPage />); change("Email", "new@example.test"); change("Password", "password-123"); change("Confirm password", "password-123"); await act(async () => submit()); expect(screen.getByRole("alert")).toHaveTextContent("Account created, but automatic sign-in failed"); expect(screen.getByRole("button", { name: "Account created", exact: true })).toBeDisabled(); expect(screen.getByRole("link", { name: "Access terminal", exact: true })).toHaveAttribute("href", "/login");
});
it("retains failed recovery drafts and keeps the existing reset payload", async () => {
  mocks.post.mockRejectedValueOnce(new Error("Denied")); mount(<ForgotAccessPage />); change("Email", " new@example.test "); change("New password", "password-123"); change("Confirm new password", "password-123"); await act(async () => submit()); expect(screen.getByRole("alert")).toHaveTextContent("Could not reset access"); expect(screen.getByLabelText("New password")).toHaveValue("password-123"); expect(mocks.post).toHaveBeenCalledWith("/auth/forgot-access", { email: "new@example.test", new_password: "password-123" });
});
it("cancels recovery navigation when the user leaves its success message", async () => {
  vi.useFakeTimers(); const view = mount(<ForgotAccessPage />); change("Email", "new@example.test"); change("New password", "password-123"); change("Confirm new password", "password-123"); await act(async () => submit()); expect(screen.getByRole("status")).toHaveTextContent("Request completed"); view.unmount(); await act(async () => vi.advanceTimersByTimeAsync(1000)); expect(mocks.navigate).not.toHaveBeenCalled();
});
