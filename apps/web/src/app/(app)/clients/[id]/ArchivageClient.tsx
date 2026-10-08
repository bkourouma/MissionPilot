"use client";

import { BoutonConfirmation } from "../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../components/ui/Bouton";
import { api } from "../../../../lib/api";
import type { Client } from "../../../../lib/clients";

/** Archiver (le client disparaît des listes par défaut) ou réactiver une fiche. */
export function ArchivageClient({ client }: { client: Client }) {
  const f = useFormulaire<never>();
  const basculer = () =>
    f.envoyer({ ok: true, charge: { actif: !client.actif } }, (c) =>
      api.patch(`/api/clients/${encodeURIComponent(client.id)}`, c),
    );
  return (
    <>
      {client.actif ? (
        <BoutonConfirmation
          libelle="Archiver"
          question="Archiver ce client ? Il n'apparaîtra plus dans la liste des clients actifs."
          libelleConfirmation="Oui, archiver"
          texteChargement="Archivage…"
          action={basculer}
        />
      ) : (
        <Bouton
          variante="secondaire"
          chargement={f.enCours}
          texteChargement="Réactivation…"
          onClick={basculer}
        >
          Réactiver
        </Bouton>
      )}
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Action impossible"
      />
    </>
  );
}
