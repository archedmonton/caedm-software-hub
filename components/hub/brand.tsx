import Image from "next/image";
import Link from "next/link";
import logo from "@/lib/assets/caedm-logo.png";

export function Brand({
  href = "/login",
  compact = false,
}: {
  href?: string;
  compact?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`caedm-brand ${compact ? "caedm-brand-compact" : ""}`}
      aria-label="CAEDM Software Hub home"
    >
      <span className="caedm-logo-surface">
        <Image
          src={logo}
          loading="eager"
          alt="The Catholic Archdiocese of Edmonton"
          sizes={compact ? "190px" : "(max-width: 650px) 210px, 286px"}
          className="caedm-logo"
        />
      </span>
      <span className="caedm-product-name">Software Hub</span>
    </Link>
  );
}
