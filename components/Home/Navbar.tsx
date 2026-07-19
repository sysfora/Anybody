"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Menu, X, Github } from "lucide-react";
import logoWhite from "@/assets/LogoWhite.png";
import logoBlack from "@/assets/LogoBlack.png";
import { useTheme } from "@teispace/next-themes";
import pb from "@/lib/pocketbase";

export function Navbar() {
    const { theme, resolvedTheme } = useTheme();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [isLoggedIn, setIsLoggedIn] = useState(false);

    useEffect(() => {
        setMounted(true);
        setIsLoggedIn(pb.authStore.isValid);
    }, []);

    const currentTheme = mounted ? (theme === "system" ? resolvedTheme : theme) : "dark";
    const Logo = currentTheme === "dark" ? logoWhite : logoBlack;

    if (!mounted) {
        return null;
    }

    const navLinks = [
        { name: "Home", href: "/" },
        { name: "Showcase", href: "/showcase" },
        { name: "Our Story", href: "/our-story" },
        { name: "Star us on GitHub", href: "https://github.com/Sysfora/Anybody", external: true, icon: Github },
    ];

    const actionButtons = isLoggedIn
        ? [{ name: "Dashboard", href: "/chat", variant: "default" }]
        : [
            { name: "Log In", href: "/login", variant: "ghost" },
            { name: "Get Started", href: "/register", variant: "default" },
        ];

    return (
        <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/40 bg-white/80 dark:bg-black/80 backdrop-blur-lg">
            <div className="container mx-auto px-6">
                <div className="flex h-16 items-center justify-between">
                    {/* Logo */}
                    <div className="flex items-center">
                        <Link href="/" className="flex items-center">
                            <Image
                                key={currentTheme}
                                src={Logo}
                                alt="Anybody Logo"
                                width={500}
                                height={500}
                                className="h-8 w-auto"
                                priority
                                unoptimized
                            />
                        </Link>
                    </div>

                    {/* Desktop Navigation Links */}
                    <div className="hidden md:flex items-center gap-6 pl-12">
                        {navLinks.map((link) => {
                            const Icon = link.icon;
                            return (
                                <Link
                                    key={link.name}
                                    href={link.href}
                                    target={link.external ? "_blank" : undefined}
                                    rel={link.external ? "noopener noreferrer" : undefined}
                                    className="flex items-center gap-1.5 text-sm font-medium text-black/80 dark:text-white/80 hover:text-black dark:hover:text-white transition-colors relative group"
                                >
                                    {Icon && <Icon className="h-4 w-4" />}
                                    {link.name}
                                    <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-[#da2a1d] transition-all duration-300 group-hover:w-full" />
                                </Link>
                            );
                        })}
                    </div>

                    {/* iPad Actions */}
                    <div className="hidden md:flex lg:hidden items-center gap-3">
                        <ThemeToggle />
                        {actionButtons.map((button) => (
                            <Link key={button.name} href={button.href}>
                                <Button
                                    variant={button.variant as "ghost" | "default"}
                                    className={`text-sm font-medium ${
                                        button.variant === "ghost" 
                                            ? "text-black dark:text-white hover:text-black dark:hover:text-white hover:bg-[#da2a1d]/20" 
                                            : "bg-[#da2a1d] text-white hover:bg-[#da2a1d]/90 hover:text-white"
                                    }`}
                                >
                                    {button.name}
                                </Button>
                            </Link>
                        ))}
                    </div>

                    {/* Desktop Actions */}
                    <div className="hidden lg:flex items-center gap-3">
                        <ThemeToggle />
                        {actionButtons.map((button) => (
                            <Link key={button.name} href={button.href}>
                                <Button
                                    variant={button.variant as "ghost" | "default"}
                                    className={`text-sm font-medium ${
                                        button.variant === "ghost" 
                                            ? "text-black dark:text-white hover:text-black dark:hover:text-white hover:bg-[#da2a1d]/20" 
                                            : "bg-[#da2a1d] text-white hover:bg-[#da2a1d]/90 hover:text-white"
                                    }`}
                                >
                                    {button.name}
                                </Button>
                            </Link>
                        ))}
                    </div>

                    {/* Mobile Menu Button */}
                    <div className="md:hidden flex items-center gap-2">
                        <ThemeToggle />
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                            className="text-black dark:text-white hover:text-black dark:hover:text-white hover:bg-[#da2a1d]/20"
                        >
                            {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                        </Button>
                    </div>
                </div>

                {/* Mobile Menu */}
                {isMobileMenuOpen && (
                    <div className="md:hidden border-t border-border/40 bg-white/95 dark:bg-black/95 backdrop-blur-lg">
                        <div className="px-2 pt-2 pb-3 space-y-1">
                            {navLinks.map((link) => {
                                const Icon = link.icon;
                                return (
                                    <Link
                                        key={link.name}
                                        href={link.href}
                                        target={link.external ? "_blank" : undefined}
                                        rel={link.external ? "noopener noreferrer" : undefined}
                                        className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-black/80 dark:text-white/80 hover:text-black dark:hover:text-white hover:bg-[#da2a1d]/10 rounded-md transition-colors"
                                        onClick={() => setIsMobileMenuOpen(false)}
                                    >
                                        {Icon && <Icon className="h-4 w-4" />}
                                        {link.name}
                                    </Link>
                                );
                            })}
                            <div className="pt-2 border-t border-border/40 dark:border-gray-800">
                                <div className="px-3 py-2 space-y-2">
                                    {actionButtons.map((button) => (
                                        <Link key={button.name} href={button.href}>
                                            <Button
                                                variant={button.variant as "ghost" | "default"}
                                                className={`w-full text-sm font-medium ${
                                                    button.variant === "ghost" 
                                                        ? "text-black dark:text-white hover:text-black dark:hover:text-white hover:bg-[#da2a1d]/20" 
                                                        : "bg-[#da2a1d] text-white hover:bg-[#da2a1d]/90 hover:text-white"
                                                }`}
                                            >
                                                {button.name}
                                            </Button>
                                        </Link>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </nav>
    );
}

