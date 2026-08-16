import { ModalRootProps, ModalRoot, TextField } from '@decky/ui';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';

type MyProps = ModalRootProps & {
    setModalResult?(result: string): void;
    promptText: string;
};

export const SearchModal = ({
    closeModal,
    setModalResult,
    promptText,
}: MyProps) => {
    const [searchText, setSearchText] = useState('');
    const handleText = (e: ChangeEvent<HTMLInputElement>) => {
        setSearchText(e.target.value);
    };
    const handleSubmit = () => {
        setModalResult?.(searchText);
        closeModal?.();
    };
    const textField = useRef<{ element?: HTMLElement } | null>(null);

    useEffect(() => {
        //This will open up the virtual keyboard
        textField.current?.element?.click();
    }, []);
    return (
        <ModalRoot closeModal={handleSubmit}>
            <form>
                <TextField
                    ref={textField}
                    focusOnMount={true}
                    label="Search"
                    placeholder={promptText}
                    onChange={handleText}
                />
            </form>
        </ModalRoot>
    );
};
