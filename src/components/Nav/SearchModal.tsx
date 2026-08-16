import {
    DialogBody,
    DialogButton,
    DialogFooter,
    Focusable,
    ModalRoot,
    ModalRootProps,
    TextField,
} from '@decky/ui';
import {
    useEffect,
    useRef,
    useState,
    type ChangeEvent,
    type KeyboardEvent,
} from 'react';

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
    // Steam's TextField swallows the default Enter action, so a <form> never
    // submits; listen for the key ourselves and also offer an explicit button.
    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSubmit();
        }
    };
    const textField = useRef<{ element?: HTMLElement } | null>(null);

    useEffect(() => {
        //This will open up the virtual keyboard
        textField.current?.element?.click();
    }, []);
    return (
        <ModalRoot closeModal={handleSubmit}>
            <DialogBody>
                <TextField
                    ref={textField}
                    focusOnMount={true}
                    label="Search"
                    placeholder={promptText}
                    onChange={handleText}
                    onKeyDown={handleKeyDown}
                />
            </DialogBody>
            <DialogFooter>
                <Focusable
                    style={{ display: 'flex', justifyContent: 'flex-end' }}
                >
                    <DialogButton
                        disableNavSounds={true}
                        style={{ width: 'auto', minWidth: '120px' }}
                        onClick={handleSubmit}
                    >
                        Search
                    </DialogButton>
                </Focusable>
            </DialogFooter>
        </ModalRoot>
    );
};
