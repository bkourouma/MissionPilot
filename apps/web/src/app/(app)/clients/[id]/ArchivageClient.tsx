"use client";

import { BoutonConfirmation } from "../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { useT } from "../../../../components/i18n/FournisseurLangue";
import { Bouton } from "../../../../components/ui/Bouton";
import { api } from "../../../../lib/api";
import type { Client } from "../../../../lib/clients";

/** Archiver (le client disparaît des listes par défaut) ou réactiver une fiche. */
export function ArchivageClient({ client }: { client: Client }) {
  const t = useT();
  const f = useFormulaire<never>();
  const basculer = () =>
    f.envoyer({ ok: true, charge: { actif: !client.actif } }, (c) =>
      api.patch(`/api/clients/${encodeURIComponent(client.id)}`, c),
    );
  return (
    <>
      {client.actif ? (
        <BoutonConfirmation
          libelle={t("Archiver", "Archive")}
          question={t(
            "Archiver ce client ? Il n'apparaîtra plus dans la liste des clients actifs.",
            "Archive this client? It will no longer appear in the list of active clients.",
          )}
          libelleConfirmation={t("Oui, archiver", "Yes, archive")}
          texteChargement={t("Archivage…", "Archiving…")}
          action={basculer}
        />
      ) : (
        <Bouton
          variante="secondaire"
          chargement={f.enCours}
          texteChargement={t("Réactivation…", "Reactivating…")}
          onClick={basculer}
        >
          {t("Réactiver", "Reactivate")}
        </Bouton>
      )}
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur={t("Action impossible", "Action failed")}
      />
    </>
  );
}
