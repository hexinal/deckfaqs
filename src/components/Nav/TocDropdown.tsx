import { Dropdown, type SingleDropdownOption } from '@decky/ui';
import { useContext, type CSSProperties } from 'react';
import { AppContext } from '../../context/AppContext';
import { ActionType } from '../../reducers/AppReducer';
import { getGuideHtml, request } from '../../utils';

type TocDropdownProps = {
    style?: CSSProperties;
};

export const TocDropdown = ({ style }: TocDropdownProps) => {
    const {
        state: { currentGuide },
        dispatch,
        browserView,
    } = useContext(AppContext);
    const handleTOCChange = (data: SingleDropdownOption) => {
        const path = data.data as string;
        let anchor: string | undefined = undefined;
        const href = `${currentGuide?.guideUrl}/${path}`;
        if (path.startsWith('#')) {
            anchor = path.substring(1);
            dispatch({
                type: ActionType.UPDATE_GUIDE,
                payload: {
                    ...currentGuide,
                    anchor,
                    currentTocSection: path,
                    restoreRatio: undefined,
                },
            });
        } else {
            request(
                { browserView, dispatch },
                (ctx) => {
                    dispatch({
                        type: ActionType.UPDATE_LOADING,
                        payload: true,
                    });
                    return getGuideHtml(href, ctx);
                },
                ({ html }) => {
                    if (path.indexOf('#') > 0) {
                        anchor = path.substring(path.indexOf('#') + 1);
                    }
                    dispatch({
                        type: ActionType.UPDATE_GUIDE,
                        payload: {
                            ...currentGuide,
                            guideHtml: html,
                            anchor,
                            page: path.split('#')[0],
                            currentTocSection: path,
                            restoreRatio: undefined,
                        },
                    });
                }
            );
        }
    };
    return (
        <div style={style}>
            <Dropdown
                disableNavSounds={true}
                rgOptions={currentGuide?.guideToc ?? []}
                strDefaultLabel="TOC"
                selectedOption={currentGuide?.currentTocSection}
                renderButtonValue={(e) => {
                    return (
                        <div
                            style={{
                                overflow: 'hidden',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {e}
                        </div>
                    );
                }}
                onChange={handleTOCChange}
            />
        </div>
    );
};
