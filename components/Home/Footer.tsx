import { Mail, Github, Linkedin, Twitter } from "lucide-react";

const Footer = () => {
    const legalLinks = [
        { name: "Privacy Policy", href: "#" },
        { name: "Terms of Service", href: "#" },
    ];

    const socialLinks = [
        {
            name: "Email",
            href: "mailto:contact@example.com",
            icon: Mail,
            ariaLabel: "Email"
        },
        {
            name: "GitHub",
            href: "https://github.com",
            icon: Github,
            ariaLabel: "GitHub"
        },
        {
            name: "LinkedIn",
            href: "https://linkedin.com",
            icon: Linkedin,
            ariaLabel: "LinkedIn"
        },
        {
            name: "X",
            href: "https://x.com",
            icon: Twitter,
            ariaLabel: "X"
        },
    ];

    return (
        <footer className="relative sm:fixed sm:bottom-0 sm:left-0 sm:right-0 z-50 border-t border-border/40 bg-white/80 dark:bg-black/80 backdrop-blur-lg py-3 sm:py-4">
            <div className="container mx-auto px-6">
                <div className="flex flex-col md:flex-row items-center justify-between gap-2 md:gap-4">
                    {/* Left side - Legal links */}
                    <div className="flex items-center gap-3 md:gap-6 text-xs md:text-sm text-black dark:text-white">
                        {legalLinks.map((link) => (
                            <a
                                key={link.name}
                                href={link.href}
                                className="hover:text-[#da2a1d] transition-colors"
                            >
                                {link.name}
                            </a>
                        ))}
                    </div>

                    {/* Center - Copyright */}
                    <div className="text-xs text-black dark:text-white text-center md:text-left">
                        © 2025 AppBuilder. All rights reserved.
                    </div>

                    {/* Right side - Contact and Social */}
                    <div className="flex items-center gap-2 md:gap-3">
                        <a href="#" className="text-xs md:text-sm text-black dark:text-white hover:text-[#da2a1d] transition-colors">
                            Contact Us
                        </a>
                        <div className="flex items-center gap-1 md:gap-2">
                            {socialLinks.map((social) => {
                                const IconComponent = social.icon;
                                return (
                                    <a
                                        key={social.name}
                                        href={social.href}
                                        className="flex h-6 w-6 md:h-8 md:w-8 items-center justify-center rounded-lg border border-border hover:border-[#da2a1d] hover:shadow-[0_0_20px_rgba(218,42,29,0.3)] transition-all"
                                        aria-label={social.ariaLabel}
                                    >
                                        <IconComponent className="h-3 w-3 md:h-4 md:w-4 text-black dark:text-white" />
                                    </a>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </footer>
    );
};

export default Footer;

