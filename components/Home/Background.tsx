"use client";

import Image from "next/image";
import { useTheme } from "@teispace/next-themes";
import { useEffect, useState } from "react";
import BackgroundBlack from "@/assets/BackgroundBlack.png";
import BackgroundWhite from "@/assets/BackgroundWhite.png";

export default function Background() {
    const { theme, resolvedTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) {
        return <div aria-hidden className="pointer-events-none fixed inset-0 -z-10" />;
    }

    const src = (theme === "dark" || resolvedTheme === "dark") ? BackgroundBlack : BackgroundWhite;

    const currentTheme = theme === "system" ? resolvedTheme : theme;

    return (
        <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
            <Image
                key={currentTheme}
                src={src}
                alt=""
                fill
                priority
                unoptimized
                className="object-cover"
            />
        </div>
    );
}

