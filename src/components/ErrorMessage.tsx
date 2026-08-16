import { DialogButton, Focusable } from '@decky/ui';
import { useContext } from 'react';
import { AppContext } from '../context/AppContext';
import { retryLastRequest } from '../utils';

/** Shown in place of a list/guide when the last fetch failed. */
export const ErrorMessage = () => {
    const {
        state: { error },
    } = useContext(AppContext);
    if (!error) return null;
    return (
        <Focusable style={{ padding: '10px 0' }}>
            <p style={{ margin: '0 0 10px' }}>{error}</p>
            <DialogButton
                disableNavSounds={true}
                style={{ width: 'auto', minWidth: '120px' }}
                onClick={retryLastRequest}
            >
                Retry
            </DialogButton>
        </Focusable>
    );
};
