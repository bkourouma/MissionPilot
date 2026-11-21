"use client";

import { useT } from "../../../../components/i18n/FournisseurLangue";
import { BoutonConfirmation } from "../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../components/ui/Bouton";
import { api } from "../../../../lib/api";
import type { Collaborateur } from "../../../../lib/collaborateurs";

export function ArchivageCollaborateur({ collaborateur }: { collaborateur: Collaborateur }) {
  const t = useT();
  const f = useFormulaire<never>();
  const basculer = () =>
    f.envoyer(
      { ok: true, charge: { actif: !collaborateur.actif } },
      (c) => api.patch(`/api/collaborateurs/${encodeURIComponent(collaborateur.id)}`, c),
      {
        succes: collaborateur.actif
          ? t("Collaborateur archivé.", "Team member archived.")
          : t("Collaborateur réactivé.", "Team member reactivated."),
      },
    );
  return (
    <>
      {collaborateur.actif ? (
        <BoutonConfirmation
          libelle={t("Archiver", "Archive")}
          question={t(
            "Archiver ce collaborateur ? Il ne sera plus proposé pour les affectations.",
            "Archive this team member? They will no longer be offered for assignments.",
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
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Action impossible", "Action not possible")}
      />
    </>
  );
}
