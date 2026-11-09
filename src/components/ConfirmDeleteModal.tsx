import { Alert, Button, Group, Modal, Text } from '@mantine/core';
import type { UseMutationResult } from '@tanstack/react-query';
import { ApiRequestError } from '../api/client';
import { notifyError } from '../api/queryClient';

type Props = {
  /** What is being deleted, e.g. "LLM endpoint". */
  noun: string;
  /** null = closed. */
  item: { id: number; name: string } | null;
  onClose: () => void;
  /** A delete mutation with `meta.silentError`: 409 IN_USE is shown here, other errors as a notification. */
  mutation: UseMutationResult<unknown, Error, number>;
};

export function ConfirmDeleteModal({ noun, item, onClose, mutation }: Props) {
  const inUse = mutation.error instanceof ApiRequestError && mutation.error.code === 'IN_USE';
  const close = () => {
    mutation.reset();
    onClose();
  };
  const confirm = () =>
    item &&
    mutation.mutate(item.id, {
      onSuccess: close,
      onError: (error) => {
        if (!(error instanceof ApiRequestError && error.code === 'IN_USE')) notifyError(error);
      },
    });

  return (
    <Modal opened={item !== null} onClose={close} title={`Delete ${noun}`}>
      {inUse ? (
        <Alert color="orange" title="Still in use" mb="md">
          &quot;{item?.name}&quot; can&apos;t be deleted because existing analyses reference this {noun}. It
          has to stay so their history remains intact.
        </Alert>
      ) : (
        <Text mb="md">
          Delete <b>{item?.name}</b>?
        </Text>
      )}
      <Group justify="flex-end">
        <Button variant="default" onClick={close}>
          {inUse ? 'Close' : 'Cancel'}
        </Button>
        {!inUse && (
          <Button color="red" loading={mutation.isPending} onClick={confirm}>
            Delete
          </Button>
        )}
      </Group>
    </Modal>
  );
}
