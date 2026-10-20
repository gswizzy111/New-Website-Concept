import { NotFoundPanel } from "@/components/marketing/not-found-panel";

// notFound() inside a marketing page: the nav and footer come from the layout.
export default function NotFound() {
  return (
    <div className="page-glow">
      <NotFoundPanel />
    </div>
  );
}
