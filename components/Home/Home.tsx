"use client";

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ArrowUp, Loader2, Paperclip } from 'lucide-react';
import NextImage from 'next/image';
import LogoFavicon from '@/assets/LogoFavicon.png';
import { useRouter } from 'next/navigation';
import { Navbar } from "@/components/Home/Navbar";
import Footer from "@/components/Home/Footer";
import Background from "@/components/Home/Background";
import { VisibilityDropdown, type VisibilityOption } from "@/components/ui/visibility-dropdown";
import { SubscriptionPopup, SUBSCRIPTION_RESUME_KEY, type SubscriptionResumeData } from "@/components/SubscriptionPopup";
import { checkProjectLimit, canCreatePrivateProject } from "@/lib/subscription";
import pb from "@/lib/pocketbase";
import { useToast } from "@/hooks/use-toast";
import { useProject } from "@/context/ProjectContext";
import { AttachmentPreviews, type AttachmentMeta } from "@/components/Dashboard/ChatMessages";
import { cn } from "@/lib/utils";
import { clearLastChatSlug } from "@/app/chat/chat-shell";

export const Content = () => {
    const router = useRouter();
    const { toast } = useToast();
    const { 
        chatInput, setChatInput, 
        chatVisibility, setChatVisibility, 
        chatAttachments, setChatAttachments, 
        setShouldAutoSubmit 
    } = useProject();
    const [mounted, setMounted] = useState(false);
    const [placeholder, setPlaceholder] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showSubscriptionPopup, setShowSubscriptionPopup] = useState(false);
    const [subscriptionReason, setSubscriptionReason] = useState<"private_project" | "out_of_limits">("out_of_limits");
    const textareaRef = React.useRef<HTMLTextAreaElement>(null);
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    useEffect(() => {
        setMounted(true);

        const checkSubscription = async () => {
            const userId = pb.authStore.model?.id;
            if (userId) {
                const canCreate = await canCreatePrivateProject(userId);
                if (canCreate) {
                    setChatVisibility("private");
                }
            }
        };
        checkSubscription();

        // Restore prompt typed before the subscription popup interrupted the flow.
        try {
            const raw = localStorage.getItem(SUBSCRIPTION_RESUME_KEY);
            if (raw) {
                const data = JSON.parse(raw) as SubscriptionResumeData;
                if (data.returnTo === '/') {
                    if (data.pendingPrompt) setChatInput(data.pendingPrompt);
                    if (data.pendingVisibility === 'public' || data.pendingVisibility === 'private') {
                        setChatVisibility(data.pendingVisibility);
                    }
                    localStorage.removeItem(SUBSCRIPTION_RESUME_KEY);
                }
            }
        } catch {
            // ignore
        }
    }, []);

    useEffect(() => {
        const placeholderTexts = [
            "I want to build an app that...",
            "helps people track their fitness goals",
            "connects local communities together",
            "makes online shopping easier",
            "helps students learn languages",
            "manages personal finances",
            "streamlines team collaboration"
        ];

        let currentIndex = 0;
        let currentText = '';
        let isDeleting = false;

        const typeWriter = () => {
            const fullText = placeholderTexts[currentIndex];

            if (isDeleting) {
                currentText = fullText.substring(0, currentText.length - 1);
            } else {
                currentText = fullText.substring(0, currentText.length + 1);
            }

            setPlaceholder(currentText);

            let typeSpeed = isDeleting ? 50 : 100;

            if (!isDeleting && currentText === fullText) {
                typeSpeed = 2000;
                isDeleting = true;
            } else if (isDeleting && currentText === '') {
                isDeleting = false;
                currentIndex = (currentIndex + 1) % placeholderTexts.length;
                typeSpeed = 500;
            }

            setTimeout(typeWriter, typeSpeed);
        };

        typeWriter();
    }, []);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        const totalAttachments = chatAttachments.length + files.length;
        if (totalAttachments > 5) {
            toast({
                title: 'Too many files',
                description: 'You can only attach up to 5 files.',
                variant: 'destructive',
            });
            return;
        }

        const validFiles = files.filter((f) => {
            if (f.size > 5 * 1024 * 1024) {
                toast({
                    title: 'File too large',
                    description: `${f.name} exceeds the 5MB limit.`,
                    variant: 'destructive',
                });
                return false;
            }
            return true;
        });

        setChatAttachments((prev) => [...prev, ...validFiles]);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleRemoveAttachment = (attachment: AttachmentMeta) => {
        setChatAttachments((prev) => prev.filter((f) => f.name !== attachment.name || f.size !== attachment.size));
    };

    const [attachmentMetas, setAttachmentMetas] = useState<AttachmentMeta[]>([]);

    useEffect(() => {
        const metas = chatAttachments.map((f) => ({
            name: f.name,
            url: URL.createObjectURL(f),
            mimeType: f.type,
            size: f.size,
        }));
        setAttachmentMetas(metas);
        return () => {
            metas.forEach((m) => URL.revokeObjectURL(m.url));
        };
    }, [chatAttachments]);

    const handleBuild = async () => {
        const message = chatInput.trim();
        if (!message) return;

        const userId = pb.authStore.model?.id;

        if (!userId) {
            toast({
                title: "Please log in",
                description: "You need to log in to start building.",
                variant: "destructive",
            });
            router.push('/login');
            return;
        }

        setIsSubmitting(true);

        setShouldAutoSubmit(true);

        clearLastChatSlug();
        router.push('/chat');
    };

    const handleVisibilityChange = async (newVisibility: VisibilityOption) => {
        if (newVisibility === "private") {
            const userId = pb.authStore.model?.id;
            if (!userId) {
                toast({
                    title: "Please log in",
                    description: "You need to log in to create private projects.",
                    variant: "destructive",
                });
                return;
            }

            const canCreate = await canCreatePrivateProject(userId);
            if (!canCreate) {
                setSubscriptionReason("private_project");
                setShowSubscriptionPopup(true);
                return;
            }
        }

        setChatVisibility(newVisibility);
    };

    const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setChatInput(e.target.value);

        if (textareaRef.current) {
            const cursorPosition = textareaRef.current.selectionStart;
            const currentScrollY = window.scrollY;

            textareaRef.current.style.height = 'auto';
            const containerHeight = 250;
            const bottomSectionHeight = 60;
            const paddingHeight = 32;
            const maxTextareaHeight = containerHeight - bottomSectionHeight - paddingHeight;

            const newHeight = Math.min(textareaRef.current.scrollHeight, maxTextareaHeight);
            textareaRef.current.style.height = `${newHeight}px`;

            textareaRef.current.style.overflowY =
                textareaRef.current.scrollHeight > maxTextareaHeight ? 'auto' : 'hidden';

            textareaRef.current.setSelectionRange(cursorPosition, cursorPosition);
            window.scrollTo(0, currentScrollY);
        }
    };

    if (!mounted) {
        return null;
    }

    return (
        <section id="hero" className="relative z-10 flex items-center justify-center min-h-[90vh] px-4 sm:px-6 md:px-8 py-12 pt-24 overflow-hidden">
            <div className="relative z-10 max-w-4xl mx-auto text-center space-y-6 sm:space-y-5">
                {/* Logo */}
                <div className="flex justify-center animate-[float_6s_ease-in-out_infinite]">
                    <div className="relative">
                        <NextImage
                            src={LogoFavicon}
                            alt="Yoo Logo"
                            width={96}
                            height={96}
                            className="h-16 w-16 sm:h-20 sm:w-20 md:h-24 md:w-24 object-contain"
                        />
                    </div>
                </div>

                {/* Main Heading */}
                <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight">
                    <span className="text-black dark:text-white">The Open-Source AI App Builder</span>
                </h1>

                {/* Description */}
                <p className="text-sm sm:text-base md:text-lg text-foreground max-w-2xl mx-auto px-4 sm:px-0">
                    Anybody can build apps and websites with AI
                </p>

                {/* Input */}
                <div className="max-w-2xl mx-auto px-4 sm:px-0">
                    <div className="relative group">
                        <div className="bg-white dark:bg-black border-2 border-border rounded-2xl p-3 sm:p-4 hover:border-[#da2a1d] hover:shadow-[0_0_30px_rgba(218,42,29,0.6)] focus-within:border-[#da2a1d] focus-within:shadow-[0_0_30px_rgba(218,42,29,0.6)] transition-all duration-300 max-h-[350px] sm:max-h-[400px] flex flex-col">
                            {chatAttachments.length > 0 && (
                                <div className="px-1 pt-1">
                                    <AttachmentPreviews
                                        attachments={attachmentMetas}
                                        onRemove={handleRemoveAttachment}
                                        variant="input"
                                    />
                                </div>
                            )}
                            <div className="flex-1 mb-3 min-h-0">
                                <Textarea
                                    ref={textareaRef}
                                    placeholder={placeholder}
                                    value={chatInput}
                                    onChange={handleTextareaChange}
                                    onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            void handleBuild();
                                        }
                                    }}
                                    className="w-full h-full bg-transparent border-0 text-sm sm:text-base text-black dark:text-white placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 resize-none scrollbar-thin scrollbar-track-transparent scrollbar-thumb-[#da2a1d]/30 hover:scrollbar-thumb-[#da2a1d]/50 scrollbar-thumb-rounded-full"
                                />
                            </div>
                            <div className="flex items-center justify-between flex-shrink-0">
                                <div className="flex items-center gap-2">
                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        onChange={handleFileChange}
                                        multiple
                                        className="hidden"
                                    />
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        className="h-8 w-8 rounded-full text-muted-foreground hover:bg-muted"
                                    >
                                        <Paperclip className="h-4 w-4" />
                                    </Button>
                                    <VisibilityDropdown
                                        value={chatVisibility}
                                        onValueChange={handleVisibilityChange}
                                    />
                                </div>
                                <Button
                                    variant="default"
                                    size="icon"
                                    onClick={() => void handleBuild()}
                                    disabled={isSubmitting || (!chatInput.trim() && chatAttachments.length === 0)}
                                    className="rounded-full h-8 w-8 sm:h-10 sm:w-10 bg-black dark:bg-white text-white dark:text-black hover:bg-black/70 dark:hover:bg-white/70"
                                >
                                    {isSubmitting ? (
                                        <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 animate-spin" />
                                    ) : (
                                        <ArrowUp className="h-4 w-4 sm:h-5 sm:w-5" />
                                    )}
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <SubscriptionPopup
                open={showSubscriptionPopup}
                onOpenChange={setShowSubscriptionPopup}
                reason={subscriptionReason}
                returnTo="/"
                pendingPrompt={chatInput}
                pendingVisibility={chatVisibility}
            />
        </section>
    );
};

export const Home = () => {
    return (
        <>
            <Background />
            <div className="min-h-screen flex flex-col relative overflow-x-hidden">
                <Navbar />
                <main className="flex-1 bg-transparent sm:pb-20">
                    <Content />
                </main>
                <Footer />
            </div>
        </>
    );
};
