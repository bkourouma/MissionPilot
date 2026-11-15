"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { BoutonConfirmation } from "../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../components/ui/Bouton";
import { Carte } from "../../../../components/ui/Carte";
import { useLangue, useT } from "../../../../components/i18n/FournisseurLangue";
import { Champ } from "../../../../components/ui/Champ";
import { api } from "../../../../lib/api";
import {
  propositionDuplication,
  validerTypeMission,
  SAISIE_TYPE_VIDE,
  type TypeMission,
} from "../../../../lib/catalogue";

/** Validation des valeurs de départ, duplication, archivage (catalogue.ecrire). */
export function ActionsType({ type }: { type: TypeMission }) {
  const t = useT();
  const [duplication, setDuplication] = useState(false);
  const etat = useFormulaire<never>();
  const chemin = `/api/types-mission/${encodeURIComponent(type.id)}`;
  const modifier = (charge: Record<string, unknown>) =>
    etat.envoyer({ ok: true, charge }, (c) => api.patch(chemin, c));

  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={etat.erreurGlobale}
        refAlerte={etat.refAlerte}
        titreErreur={t("Action impossible", "Action failed")}
      />
      <div className="mp-barre-actions">
        {type.a_valider ? (
          <Bouton
            icone="succes"
            chargement={etat.enCours}
            texteChargement={t("Validation…", "Approving…")}
            onClick={() => modifier({ a_valider: false })}
          >
            {t("Valider ce modèle", "Approve this template")}
          </Bouton>
        ) : null}
        <Bouton
          variante="secondaire"
          icone="copie"
          aria-expanded={duplication}
          onClick={() => setDuplication((v) => !v)}
        >
          {t("Dupliquer", "Duplicate")}
        </Bouton>
        {type.actif ? (
          <BoutonConfirmation
            libelle={t("Archiver", "Archive")}
            question={t(
              "Archiver ce type ? Il ne sera plus proposé à la création de missions.",
              "Archive this type? It will no longer be offered when creating engagements.",
            )}
            libelleConfirmation={t("Oui, archiver", "Yes, archive")}
            texteChargement={t("Archivage…", "Archiving…")}
            action={() => modifier({ actif: false })}
          />
        ) : (
          <Bouton variante="secondaire" onClick={() => modifier({ actif: true })}>
            {t("Réactiver", "Reactivate")}
          </Bouton>
        )}
      </div>
      {duplication ? (
        <FormulaireDuplication type={type} onAnnuler={() => setDuplication(false)} />
      ) : null}
    </div>
  );
}

function FormulaireDuplication({ type, onAnnuler }: { type: TypeMission; onAnnuler: () => void }) {
  const router = useRouter();
  const t = useT();
  const langue = useLangue();
  const [s, setS] = useState(() => propositionDuplication(type, langue));
  const f = useFormulaire<"code" | "libelle">();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    // Mêmes règles que la création pour le code et le libellé.
    const v = validerTypeMission({ ...SAISIE_TYPE_VIDE, code: s.code, libelle: s.libelle }, langue);
    await f.envoyer(
      v.ok
        ? { ok: true, charge: { code: v.charge.code, libelle: v.charge.libelle } }
        : { ok: false, erreurs: { code: v.erreurs.code, libelle: v.erreurs.libelle } },
      (c) =>
        api.post<TypeMission>(`/api/types-mission/${encodeURIComponent(type.id)}/dupliquer`, c),
      { rafraichir: false, apres: (copie) => router.push(`/catalogue/${copie.id}`) },
    );
  }

  return (
    <Carte titre={t("Dupliquer ce type", "Duplicate this type")} niveauTitre={2}>
      <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
        <p className="mp-texte-doux">
          {t(
            "La copie reprend tout le découpage ; elle est créée active.",
            "The copy includes the whole work breakdown; it is created active.",
          )}
        </p>
        <RetourFormulaire
          erreur={f.erreurGlobale}
          refAlerte={f.refAlerte}
          titreErreur={t("Duplication impossible", "Duplication failed")}
        />
        <div className="mp-grille-champs">
          <Champ
            libelle={t("Code de la copie", "Copy code")}
            name="code"
            required
            maxLength={40}
            autoCapitalize="none"
            spellCheck={false}
            value={s.code}
            onChange={(e) => setS((x) => ({ ...x, code: e.target.value }))}
            erreur={f.erreurs.code}
            aide={t(
              "Minuscules, chiffres et tiret bas.",
              "Lowercase letters, digits and underscores.",
            )}
          />
          <Champ
            libelle={t("Libellé de la copie", "Copy label")}
            name="libelle"
            required
            maxLength={160}
            value={s.libelle}
            onChange={(e) => setS((x) => ({ ...x, libelle: e.target.value }))}
            erreur={f.erreurs.libelle}
          />
        </div>
        <div className="mp-actions-formulaire">
          <Bouton
            type="submit"
            icone="copie"
            chargement={f.enCours}
            texteChargement={t("Duplication…", "Duplicating…")}
          >
            {t("Créer la copie", "Create copy")}
          </Bouton>
          <Bouton variante="discret" onClick={onAnnuler}>
            {t("Annuler", "Cancel")}
          </Bouton>
        </div>
      </form>
    </Carte>
  );
}
