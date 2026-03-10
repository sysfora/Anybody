"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ArrowUp, Paperclip, X, FileText, Image, File, Loader2 } from 'lucide-react';
import NextImage from 'next/image';
import LogoFavicon from '@/assets/LogoFavicon.png';
import { useRouter } from 'next/navigation';
import { Navbar } from "@/components/Home/Navbar";
import Footer from "@/components/Home/Footer";
import Background from "@/components/Home/Background";
import { VisibilityDropdown, type VisibilityOption } from "@/components/ui/visibility-dropdown";
import { SubscriptionPopup } from "@/components/SubscriptionPopup";
import { checkProjectLimit, canCreatePrivateProject } from "@/lib/subscription";
import pb from "@/lib/pocketbase";
import { useToast } from "@/hooks/use-toast";
import { useProject } from "@/context/ProjectContext";

export const Content = () => {
    const router = useRouter();
    const { toast } = useToast();
    const { setPendingSubmission } = useProject();
    const [mounted, setMounted] = useState(false);
    const [appIdea, setAppIdea] = useState('');
    const [placeholder, setPlaceholder] = useState('');
    const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
    const [filePreviews, setFilePreviews] = useState<{ [key: string]: string }>({});
    const [visibility, setVisibility] = useState<VisibilityOption>("public");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showSubscriptionPopup, setShowSubscriptionPopup] = useState(false);
    const [subscriptionReason, setSubscriptionReason] = useState<"private_project" | "out_of_limits">("out_of_limits");
    const textareaRef = React.useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setMounted(true);
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

    const handleBuild = async () => {
        if (appIdea.trim() || attachedFiles.length > 0) {
            const userId = pb.authStore.model?.id;
            
            if (!userId) {
                toast({
                    title: "Please log in",
                    description: "You need to log in to start generating projects.",
                    variant: "destructive",
                });
                router.push('/login');
                return;
            }

            if (visibility === "private") {
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

            const isOutOfLimits = await checkProjectLimit(userId);
            if (isOutOfLimits) {
                setSubscriptionReason("out_of_limits");
                setShowSubscriptionPopup(true);
                return;
            }

            setIsSubmitting(true);
            
            if (attachedFiles.length > 0) {
                const MAX_FILE_SIZE = 10 * 1024 * 1024;
                const MAX_FILES = 5;

                const invalidSizeFiles = attachedFiles.filter(f => f.size > MAX_FILE_SIZE);
                if (invalidSizeFiles.length > 0) {
                    toast({
                        title: "File size too large",
                        description: `The following file(s) exceed the 10MB limit: ${invalidSizeFiles.map(f => f.name).join(', ')}`,
                        variant: "destructive",
                    });
                    setIsSubmitting(false);
                    return;
                }

                if (attachedFiles.length > MAX_FILES) {
                    toast({
                        title: "Too many files",
                        description: `You can attach a maximum of ${MAX_FILES} files. You currently have ${attachedFiles.length} file(s).`,
                        variant: "destructive",
                    });
                    setIsSubmitting(false);
                    return;
                }

                const filesToStore: Array<{ name: string; type: string; size: number; data: string }> = [];
                let filesProcessed = 0;
                let hasError = false;

                attachedFiles.forEach((file) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                        try {
                            const base64String = reader.result as string;
                            filesToStore.push({
                                name: file.name,
                                type: file.type,
                                size: file.size,
                                data: base64String
                            });
                        } catch (error) {
                            console.error('Error processing file:', file.name, error);
                            hasError = true;
                        }
                        
                        filesProcessed++;
                        if (filesProcessed === attachedFiles.length) {
                            // Store in context
                            setPendingSubmission({
                                message: appIdea.trim() || null,
                                visibility: visibility,
                                files: filesToStore
                            });
                            router.push('/chat');
                        }
                    };
                    reader.onerror = () => {
                        console.error('Error reading file:', file.name);
                        hasError = true;
                        filesProcessed++;
                        if (filesProcessed === attachedFiles.length) {
                            // Store in context even if some files failed
                            setPendingSubmission({
                                message: appIdea.trim() || null,
                                visibility: visibility,
                                files: filesToStore
                            });
                            router.push('/chat');
                        }
                    };
                    reader.readAsDataURL(file);
                });
            } else {
                // Store in context
                setPendingSubmission({
                    message: appIdea.trim() || null,
                    visibility: visibility,
                    files: []
                });
                router.push('/chat');
            }
        }
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

        setVisibility(newVisibility);
    };

    const handleFileAttach = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        const MAX_FILE_SIZE = 10 * 1024 * 1024;
        const MAX_FILES = 5;

        setAttachedFiles(prev => {
            const totalFiles = prev.length + files.length;
            if (totalFiles > MAX_FILES) {
                toast({
                    title: "Too many files",
                    description: `You can attach a maximum of ${MAX_FILES} files. You currently have ${prev.length} file(s) and tried to add ${files.length} more.`,
                    variant: "destructive",
                });
                return prev;
            }

            const invalidFiles: File[] = [];
            const validFiles: File[] = [];

            files.forEach(file => {
                if (file.size > MAX_FILE_SIZE) {
                    invalidFiles.push(file);
                } else {
                    validFiles.push(file);
                }
            });

            if (invalidFiles.length > 0) {
                toast({
                    title: "File size too large",
                    description: `The following file(s) exceed the 10MB limit: ${invalidFiles.map(f => f.name).join(', ')}`,
                    variant: "destructive",
                });
            }

            if (validFiles.length > 0) {
                const newFiles = [...prev, ...validFiles];
                validFiles.forEach(file => {
                    generateFilePreview(file);
                });
                return newFiles;
            }

            return prev;
        });
    };

    const generateFilePreview = (file: File) => {
        const reader = new FileReader();

        if (file.type.startsWith('image/')) {
            reader.onload = (e) => {
                setFilePreviews(prev => ({
                    ...prev,
                    [file.name]: e.target?.result as string
                }));
            };
            reader.readAsDataURL(file);
        } else if (file.type.startsWith('text/')) {
            reader.onload = (e) => {
                const content = e.target?.result as string;
                const preview = content.length > 200 ? content.substring(0, 200) + '...' : content;
                setFilePreviews(prev => ({
                    ...prev,
                    [file.name]: preview
                }));
            };
            reader.readAsText(file);
        }
    };

    const removeFile = (index: number) => {
        const fileToRemove = attachedFiles[index];
        setAttachedFiles(prev => prev.filter((_, i) => i !== index));
        setFilePreviews(prev => {
            const newPreviews = { ...prev };
            delete newPreviews[fileToRemove.name];
            return newPreviews;
        });
    };

    const getFileIcon = (file: File) => {
        if (file.type.startsWith('image/')) {
            return <Image className="h-4 w-4" aria-label="Image file" />;
        } else if (file.type.startsWith('text/')) {
            return <FileText className="h-4 w-4" aria-label="Text file" />;
        } else {
            return <File className="h-4 w-4" aria-label="File" />;
        }
    };

    const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setAppIdea(e.target.value);

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

            if (textareaRef.current.scrollHeight > maxTextareaHeight) {
                textareaRef.current.style.overflowY = 'auto';
            } else {
                textareaRef.current.style.overflowY = 'hidden';
            }

            textareaRef.current.setSelectionRange(cursorPosition, cursorPosition);
            window.scrollTo(0, currentScrollY);
        }
    };

    if (!mounted) {
        return null;
    }

    return (
        <section className="relative z-10 flex items-center justify-center h-full px-4 sm:px-6 md:px-8 py-8 overflow-hidden">
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
                    <span className="text-black dark:text-white">What do you want to build?</span>
                    <br />
                </h1>

                {/* Description */}
                <p className="text-sm sm:text-base md:text-lg text-foreground max-w-2xl mx-auto px-4 sm:px-0">
                    Create apps & websites by chatting with AI.
                </p>

                {/* Search Input */}
                <div className="max-w-2xl mx-auto space-y-4 px-4 sm:px-0">
                    {/* File Input */}
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        onChange={handleFileChange}
                        className="hidden"
                        accept="image/*,.pdf,.doc,.docx,.txt"
                    />

                    {/* File Previews */}
                    {attachedFiles.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-4">
                            {attachedFiles.map((file, index) => (
                                <div key={index} className="relative bg-white dark:bg-black border border-border rounded-lg p-2 w-16 h-16 flex flex-col items-center justify-center">
                                    {filePreviews[file.name] ? (
                                        <>
                                            {file.type.startsWith('image/') ? (
                                                <NextImage
                                                    src={filePreviews[file.name]}
                                                    alt={`Preview of ${file.name}`}
                                                    width={64}
                                                    height={64}
                                                    className="w-full h-full object-cover rounded"
                                                />
                                            ) : file.type.startsWith('text/') ? (
                                                <div className="w-full h-full bg-muted/30 rounded flex items-center justify-center">
                                                    <FileText className="h-4 w-4 text-muted-foreground" />
                                                </div>
                                            ) : (
                                                <div className="w-full h-full bg-muted/30 rounded flex items-center justify-center">
                                                    {getFileIcon(file)}
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        <div className="w-full h-full bg-muted/30 rounded flex items-center justify-center">
                                            <span className="text-xs font-medium text-muted-foreground uppercase">
                                                {file.name.split('.').pop() || 'FILE'}
                                            </span>
                                        </div>
                                    )}

                                    <button
                                        onClick={() => removeFile(index)}
                                        className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full w-4 h-4 flex items-center justify-center hover:bg-destructive/90 transition-colors"
                                    >
                                        <X className="h-2 w-2" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="relative group">
                        <div className="bg-white dark:bg-black border-2 border-border rounded-2xl p-3 sm:p-4 hover:border-[#da2a1d] hover:shadow-[0_0_30px_rgba(218,42,29,0.6)] focus-within:border-[#da2a1d] focus-within:shadow-[0_0_30px_rgba(218,42,29,0.6)] transition-all duration-300 max-h-[200px] sm:max-h-[250px] flex flex-col">
                            <div className="flex-1 mb-3 min-h-0">
                                <Textarea
                                    ref={textareaRef}
                                    placeholder={placeholder}
                                    value={appIdea}
                                    onChange={handleTextareaChange}
                                    onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            handleBuild();
                                        }
                                    }}
                                    className="w-full h-full bg-transparent border-0 text-sm sm:text-base text-black dark:text-white placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 resize-none scrollbar-thin scrollbar-track-transparent scrollbar-thumb-[#da2a1d]/30 hover:scrollbar-thumb-[#da2a1d]/50 scrollbar-thumb-rounded-full"
                                />
                            </div>
                            <div className="flex items-center justify-between flex-shrink-0">
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={handleFileAttach}
                                        className="flex items-center justify-center p-1.5 sm:p-2 hover:bg-[#da2a1d]/10 rounded-lg transition-colors group/attach"
                                    >
                                        <Paperclip className="h-3 w-3 sm:h-4 sm:w-4 text-muted-foreground group-hover/attach:text-[#da2a1d] transition-colors" />
                                    </button>
                                    <VisibilityDropdown
                                        value={visibility}
                                        onValueChange={handleVisibilityChange}
                                    />
                                </div>
                                <Button
                                    variant="default"
                                    size="icon"
                                    onClick={handleBuild}
                                    disabled={isSubmitting || (!appIdea.trim() && attachedFiles.length === 0)}
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

            {/* Subscription Popup */}
            <SubscriptionPopup
                open={showSubscriptionPopup}
                onOpenChange={setShowSubscriptionPopup}
                reason={subscriptionReason}
            />
        </section>
    );
};

export const Home = () => {
    return (
        <>
            <Background />
            <div className="h-screen flex flex-col overflow-hidden">
                <Navbar />
                <main className="flex-1 overflow-hidden">
                    <Content />
                </main>
                <Footer />
            </div>
        </>
    );
}

