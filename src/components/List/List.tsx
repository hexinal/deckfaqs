import { useContext } from 'react';
import { AppContext } from '../../context/AppContext';
import { ErrorMessage } from '../ErrorMessage';
import { ListElement } from './ListElement';

export type ListItem = {
    text: string;
    url?: string | undefined;
    /** Optional group heading rendered above the first item of each run. */
    group?: string | undefined;
};

export type ListProps = {
    header: string;
    data: ListItem[];
    handleClick: (text: string) => void;
};

export const List = ({ data, header, handleClick }: ListProps) => {
    const {
        state: { isLoading, error },
    } = useContext(AppContext);
    if (error) return <ErrorMessage />;
    return isLoading ? (
        <div className="lds-ring">
            <div></div>
            <div></div>
            <div></div>
            <div></div>
        </div>
    ) : (
        <div style={{ height: '100%' }}>
            <div
                style={{
                    fontSize: '16px',
                    letterSpacing: '0.5px',
                    textTransform: 'uppercase',
                    display: 'inline-block',
                    width: '100%',
                }}
            >
                {header}
            </div>
            <div>
                {data?.map(({ text, url, group }, index) => (
                    <div key={url ?? text}>
                        {group && group !== data[index - 1]?.group && (
                            <div
                                style={{
                                    fontSize: '12px',
                                    letterSpacing: '0.5px',
                                    textTransform: 'uppercase',
                                    opacity: 0.7,
                                    padding: '8px 0 2px',
                                }}
                            >
                                {group}
                            </div>
                        )}
                        <ListElement
                            displayText={text}
                            value={url ?? text}
                            onClick={handleClick}
                        />
                    </div>
                ))}
                {data.length == 0 && <p>No results</p>}
            </div>
        </div>
    );
};
