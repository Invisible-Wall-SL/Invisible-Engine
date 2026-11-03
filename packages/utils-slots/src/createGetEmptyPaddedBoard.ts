export const createGetEmptyPaddedBoard = ({
	reelsDimensions,
}: {
	reelsDimensions: { x: number; y: number };
}) => {
	const getEmptyBoard = () =>
		Array.from({ length: reelsDimensions.x }, () =>
			Array.from({ length: reelsDimensions.y + 2 }, () => null),
		);

	return { getEmptyBoard };
};
