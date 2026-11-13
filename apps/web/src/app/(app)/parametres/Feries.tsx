"use client";

import { useLangue, useT } from "../../../components/i18n/FournisseurLangue";
import { useRafraichir } from "../../../components/formulaires/useRafraichir";
import { useState, type FormEvent } from "react";
import { BoutonConfirmation } from "../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../components/formulaires/useFormulaire";
import { Alerte } from "../../../components/ui/Alerte";
import { Bouton } from "../../../components/ui/Bouton";
import { CaseACocher } from "../../../components/ui/CaseACocher";
import { Champ } from "../../../components/ui/Champ";
import { api } from "../../../lib/api";
import { messageErreurLangue, messageSpecifiqueLangue } from "../../../lib/double-authentification";
import { validerFerie, type Ferie, type SaisieFerie } from "../../../lib/cabinet";
import { formaterDate } from "../../../lib/format";

export function AjoutFerie({ annee }: { annee: number }) {
  const t = useT();
  const langue = useLangue();
  const vide: SaisieFerie = { date: "", libelle: "", nationale: true };
  const [saisie, setSaisie] = useState<SaisieFerie>(vide);
  const f = useFormulaire<"date" | "libelle" | "nationale">();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(validerFerie(saisie, langue), (c) => api.post("/api/cabinet/feries", c), {
      succes: t(
        `Jour férié « ${saisie.libelle.trim()} » ajouté.`,
        `Public holiday "${saisie.libelle.trim()}" added.`,
      ),
      apres: () => setSaisie(vide),
      messageSpecifique: messageSpecifiqueLangue(langue),
    });
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-labelledby="titre-ajout-ferie"
    >
      <h3 id="titre-ajout-ferie" className="mp-sous-formulaire__titre">
        {t("Ajouter un jour férié", "Add a public holiday")}
      </h3>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Ajout impossible", "Unable to add")}
      />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Date", "Date")}
          type="date"
          name="date"
          required
          min={`${annee - 1}-01-01`}
          max={`${annee + 1}-12-31`}
          value={saisie.date}
          onChange={(e) => setSaisie((s) => ({ ...s, date: e.target.value }))}
          erreur={f.erreurs.date}
        />
        <Champ
          libelle={t("Nom du jour férié", "Public holiday name")}
          name="libelle"
          required
          maxLength={120}
          value={saisie.libelle}
          onChange={(e) => setSaisie((s) => ({ ...s, libelle: e.target.value }))}
          erreur={f.erreurs.libelle}
          aide={t("Ex. Tabaski, Fête de l'Indépendance.", "E.g. Tabaski, Independence Day.")}
        />
      </div>
      <CaseACocher
        libelle={t("Fête nationale", "National holiday")}
        aide={t(
          "Décochez pour un jour chômé propre au cabinet (pont, fermeture annuelle).",
          "Uncheck for a day off specific to the firm (bridge day, annual closure).",
        )}
        checked={saisie.nationale}
        onChange={(e) => setSaisie((s) => ({ ...s, nationale: e.target.checked }))}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="secondaire"
          icone="plus"
          chargement={f.enCours}
          texteChargement={t("Ajout…", "Adding…")}
        >
          {t("Ajouter le jour férié", "Add the public holiday")}
        </Bouton>
      </div>
    </form>
  );
}

export function SuppressionFerie({ ferie }: { ferie: Ferie }) {
  const t = useT();
  const langue = useLangue();
  const { rafraichir } = useRafraichir();
  const [erreur, setErreur] = useState<string | null>(null);
  return (
    <div className="mp-liste-lignes__actions">
      <BoutonConfirmation
        libelle={t("Supprimer", "Delete")}
        ariaLabel={t(
          `Supprimer ${ferie.libelle} du ${formaterDate(ferie.date)}`,
          `Delete ${ferie.libelle} on ${formaterDate(ferie.date, "UTC", langue)}`,
        )}
        icone="corbeille"
        question={t(`Supprimer « ${ferie.libelle} » ?`, `Delete "${ferie.libelle}"?`)}
        libelleConfirmation={t("Oui, supprimer", "Yes, delete")}
        texteChargement={t("Suppression…", "Deleting…")}
        action={async () => {
          setErreur(null);
          try {
            await api.supprimer(`/api/cabinet/feries/${encodeURIComponent(ferie.id)}`);
            rafraichir();
          } catch (e) {
            setErreur(messageErreurLangue(e, langue));
            return false;
          }
        }}
      />
      {erreur ? (
        <Alerte tonalite="danger" titre={t("Suppression impossible", "Unable to delete")}>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
    </div>
  );
}

/** Pré-remplit l'année avec les jours fériés civils du pays (UEMOA), marqués « à vérifier ». */
export function FeriesParDefaut({ annee }: { annee: number }) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"annee">();
  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Pré-remplissage impossible", "Unable to pre-fill")}
      />
      <div>
        <Bouton
          variante="secondaire"
          icone="calendrier"
          chargement={f.enCours}
          texteChargement={t("Pré-remplissage…", "Pre-filling…")}
          onClick={() =>
            f.envoyer(
              { ok: true, charge: { annee } },
              (c) => api.post<{ ajoutes: number }>("/api/cabinet/feries/par-defaut", c),
              {
                succes: t(
                  `Jours fériés ${annee} du pays ajoutés (les dates déjà saisies sont conservées). Vérifiez-les.`,
                  `Public holidays ${annee} for the country added (dates already entered are kept). Please check them.`,
                ),
                messageSpecifique: messageSpecifiqueLangue(langue),
              },
            )
          }
        >
          {t(
            `Pré-remplir les jours fériés ${annee} du pays`,
            `Pre-fill the public holidays ${annee} for the country`,
          )}
        </Bouton>
      </div>
    </div>
  );
}

/** Valide un jour férié proposé par défaut. */
export function ValidationFerie({ ferie }: { ferie: Ferie }) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<never>();
  return (
    <div className="mp-liste-lignes__actions">
      <Bouton
        variante="discret"
        icone="succes"
        chargement={f.enCours}
        texteChargement={t("Validation…", "Approving…")}
        aria-label={t(
          `Valider ${ferie.libelle} du ${formaterDate(ferie.date)}`,
          `Approve ${ferie.libelle} on ${formaterDate(ferie.date, "UTC", langue)}`,
        )}
        onClick={() =>
          f.envoyer(
            { ok: true, charge: null },
            () => api.post(`/api/cabinet/feries/${encodeURIComponent(ferie.id)}/valider`),
            { messageSpecifique: messageSpecifiqueLangue(langue) },
          )
        }
      >
        {t("Valider", "Approve")}
      </Bouton>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur={t("Validation impossible", "Unable to approve")}
      />
    </div>
  );
}
